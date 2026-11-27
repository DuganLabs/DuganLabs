/**
 * The lead billing lifecycle (GP-106), shared by `/leads` and `/leads/:id`.
 *
 * Every lead carries exactly one lifecycle action for its stage —
 * Qualify → Accept → Withdraw, nothing once withdrawn. The stage is read
 * from the three timestamps the API stamps (`qualifiedAt` / `acceptedAt` /
 * `withdrawnAt`), never from `status`. Accept is a state transition —
 * since WS-1 the fee bills at booking, not here — but it still goes
 * through an `alertdialog` that states the fee a booking will bill
 * (read from GET /api/leads/:id/fee) BEFORE the confirming click;
 * Withdraw confirms the same way and records the consumer's reason
 * (GP-105) without adjudicating it.
 *
 * `createLeadLifecycle` owns the dialogs and the calls; the route owns the
 * notice it writes to and the reload that follows.
 */

import {
  LEAD_WITHDRAWN_REASONS,
  type Lead,
  type LeadWithdrawnReason,
} from '@greenput/shared/models';
import type { PlatformDeps } from '../../deps.js';
import { el } from '../../lib/dom.js';
import { formatCurrency } from '../../lib/format.js';
import {
  mountConfirmDialog,
  type ConfirmDialogMount,
} from '../shared/dialog.js';
import { field as formField } from '../shared/field.js';

export type LifecycleStage = 'new' | 'qualified' | 'accepted' | 'withdrawn';

export type LifecycleActionName = 'qualify' | 'accept' | 'withdraw';

export interface LifecycleAction {
  readonly action: LifecycleActionName;
  readonly label: string;
  readonly variant: 'secondary' | 'primary' | 'danger';
}

/** Billing-lifecycle stage, from the timestamps the API stamps. */
export function lifecycleStage(lead: Lead): LifecycleStage {
  if (lead.withdrawnAt) return 'withdrawn';
  if (lead.acceptedAt) return 'accepted';
  if (lead.qualifiedAt) return 'qualified';
  return 'new';
}

/** Exactly one action per stage; none once withdrawn. */
const LIFECYCLE_ACTIONS: Readonly<
  Record<LifecycleStage, LifecycleAction | null>
> = {
  new: { action: 'qualify', label: 'Qualify', variant: 'secondary' },
  qualified: { action: 'accept', label: 'Accept', variant: 'primary' },
  accepted: { action: 'withdraw', label: 'Withdraw', variant: 'danger' },
  withdrawn: null,
};

export function lifecycleAction(lead: Lead): LifecycleAction | null {
  return LIFECYCLE_ACTIONS[lifecycleStage(lead)];
}

export const LIFECYCLE_LABELS: Readonly<Record<LifecycleStage, string>> = {
  new: 'New',
  qualified: 'Qualified',
  accepted: 'Accepted',
  withdrawn: 'Withdrawn',
};

export function isLifecycleActionName(
  value: string,
): value is LifecycleActionName {
  return value === 'qualify' || value === 'accept' || value === 'withdraw';
}

/**
 * The words for `leads.withdrawn_reason` (GP-105). Typed against the closed
 * set, so a reason without a label — or a label without a reason — fails to
 * compile. Recorded for the owner, never adjudicated: the fee outcome does
 * not depend on which one is picked, or none.
 */
const WITHDRAWN_REASON_LABELS: Readonly<Record<LeadWithdrawnReason, string>> = {
  schedule_no_longer_works: 'Schedule no longer works',
  chose_another_provider: 'Chose another provider',
  no_longer_needed: 'No longer needed',
  other: 'Other',
};

const isWithdrawnReason = (value: string): value is LeadWithdrawnReason =>
  (LEAD_WITHDRAWN_REASONS as readonly string[]).includes(value);

/** `ev_charger` → `EV charger`, for the fee line. */
function verticalLabel(vertical: string): string {
  const words = vertical.replace(/_/g, ' ');
  return words.startsWith('ev ') ? `EV${words.slice(2)}` : words;
}

function fullName(lead: Lead): string {
  return `${lead.firstName} ${lead.lastName}`;
}

export interface LeadLifecycleHooks {
  /** Where the outcome is announced (a `role="status"` node). */
  readonly notify: (message: string) => void;
  /** Re-read the lead(s) once the API has answered. */
  readonly reload: () => Promise<unknown>;
}

export interface LeadLifecycle {
  /** Run the named action for the lead; Accept and Withdraw open a dialog. */
  run(action: LifecycleActionName, lead: Lead): void;
  dispose(): void;
}

export function createLeadLifecycle(
  deps: PlatformDeps,
  hooks: LeadLifecycleHooks,
): LeadLifecycle {
  let confirm: ConfirmDialogMount | null = null;
  const teardownConfirm = (): void => {
    confirm?.dispose();
    confirm = null;
  };

  const qualify = async (lead: Lead): Promise<void> => {
    try {
      await deps.leads.qualify(lead.id);
      hooks.notify(`Qualified ${fullName(lead)}.`);
    } catch (err) {
      hooks.notify(
        `Could not qualify ${fullName(lead)}: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
    }
    await hooks.reload();
  };

  /**
   * Accept — a state transition, NOT a billing event (WS-1: the fee
   * bills when the job books). The dialog opens at once with Confirm
   * disabled, the fee is read, and only once the figure is on screen
   * does Confirm become clickable: the price a later booking will bill
   * is stated before the click. `alreadyAccepted` is reported as such —
   * the endpoint is idempotent and the UI must not imply a charge.
   */
  const openAccept = (lead: Lead): void => {
    teardownConfirm();
    const name = fullName(lead);
    let quotedPriceUsd: number | null = null;
    const feeLine = el(
      'p',
      {
        'data-bn-lead-fee': '',
        role: 'status',
        'data-testid': 'leads-accept-fee',
      },
      'Checking the lead fee…',
    );
    const dialog = mountConfirmDialog({
      id: 'leads-accept',
      title: `Accept ${name}?`,
      description:
        'Accepting does not charge anything. The lead fee below bills when the job books into your schedule.',
      body: [feeLine],
      confirmLabel: 'Accept lead',
      onConfirm: async () => {
        const { data } = await deps.leads.accept(lead.id);
        const amount = formatCurrency(
          data.meterEvent?.priceUsd ?? quotedPriceUsd ?? 0,
        );
        if (data.alreadyAccepted) {
          hooks.notify(`${name} was already accepted — no new charge.`);
        } else {
          hooks.notify(
            `Accepted ${name} — the ${amount} lead fee bills at booking.`,
          );
        }
        await hooks.reload();
      },
      onClose: teardownConfirm,
    });
    confirm = dialog;
    dialog.setConfirmEnabled(false);
    dialog.open();
    deps.leads
      .fee(lead.id)
      .then(({ data }) => {
        if (confirm !== dialog) return;
        if (data.receive && !data.receive.ok) {
          feeLine.textContent =
            data.receive.message ??
            'A card on file is required before this workspace can accept a lead.';
          dialog.setConfirmEnabled(false);
          return;
        }
        quotedPriceUsd = data.priceUsd;
        feeLine.textContent = `Lead fee: ${formatCurrency(data.priceUsd)} (${verticalLabel(
          data.vertical,
        )})`;
        dialog.setConfirmEnabled(true);
      })
      .catch((err: unknown) => {
        if (confirm !== dialog) return;
        feeLine.textContent =
          `Could not read the lead fee — accepting is disabled. ${
            err instanceof Error ? err.message : ''
          }`.trim();
      });
  };

  const openWithdraw = (lead: Lead): void => {
    teardownConfirm();
    const name = fullName(lead);
    // Why, if the consumer said (GP-105). Optional: the fee outcome does
    // not depend on it, and "not given" is an honest answer.
    const reasonSelect = el('select', {
      'data-bn-input': '',
      'data-testid': 'leads-withdraw-reason',
    }) as HTMLSelectElement;
    reasonSelect.append(el('option', { value: '' }, 'Reason not given'));
    for (const reason of LEAD_WITHDRAWN_REASONS) {
      reasonSelect.append(
        el('option', { value: reason }, WITHDRAWN_REASON_LABELS[reason]),
      );
    }
    const dialog = mountConfirmDialog({
      id: 'leads-withdraw',
      title: `Withdraw ${name}?`,
      description:
        'The consumer is backing out. A lead fee billed at booking stands: one still pending stays collectible, and one already invoiced stays as it is.',
      body: [formField('Why are they withdrawing?', reasonSelect)],
      confirmLabel: 'Withdraw lead',
      confirmVariant: 'danger',
      onConfirm: async () => {
        const picked = reasonSelect.value;
        const { data } = await deps.leads.withdraw(
          lead.id,
          isWithdrawnReason(picked) ? picked : undefined,
        );
        hooks.notify(
          data.meterEventAdjustment === 'left_unchanged'
            ? `Withdrew ${name} — the lead fee stands and is unchanged.`
            : `Withdrew ${name}. No fee was owed.`,
        );
        await hooks.reload();
      },
      onClose: teardownConfirm,
    });
    confirm = dialog;
    dialog.open();
  };

  return {
    run(action, lead) {
      if (action === 'qualify') void qualify(lead);
      else if (action === 'accept') openAccept(lead);
      else openWithdraw(lead);
    },
    dispose: teardownConfirm,
  };
}
