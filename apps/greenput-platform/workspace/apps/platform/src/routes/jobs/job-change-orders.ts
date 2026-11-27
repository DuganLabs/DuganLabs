/**
 * The job page's Change orders section. Once a job exists its price moves
 * only through a change order — `PATCH /api/jobs/:id` answers 409
 * `CHANGE_ORDER_REQUIRED` for `lineItems` / `total` — so this is where a
 * price changes: anyone on the team proposes one (title, reason, signed
 * lines in dollars), and office and up record the homeowner's yes or no,
 * once, with a note ("approved by phone"). Approving appends the lines to
 * the job and moves its total by exactly the change, so the page re-reads
 * the job afterwards.
 *
 * Invoiced, paid and cancelled jobs take none: the API refuses with 409, and
 * this section stops offering.
 */

import type { ChangeOrder, Job, JobStatus } from '@greenput/shared/models';
import type { PlatformDeps } from '../../deps.js';
import type { ChangeOrderLineInput } from '../../api/change-orders.js';
import { clear, el, on, type Cleanup } from '../../lib/dom.js';
import { formatCurrency } from '../../lib/format.js';
import { statusBadge } from '../shared/badge.js';
import { field as formField } from '../shared/field.js';

const CLOSED: ReadonlySet<JobStatus> = new Set([
  'invoiced',
  'paid',
  'cancelled',
]);
const DECIDERS: ReadonlySet<string> = new Set(['owner', 'admin', 'office']);

const STATUS_LABEL: Readonly<Record<ChangeOrder['status'], string>> = {
  proposed: 'Waiting on homeowner',
  approved: 'Approved',
  rejected: 'Rejected',
};

/** "+$795.00", "−$150.00", "$0.00" — the sign is the point. */
export function signedCents(cents: number): string {
  const amount = formatCurrency(Math.abs(cents) / 100, { cents: true });
  if (cents > 0) return `+${amount}`;
  if (cents < 0) return `\u2212${amount}`;
  return amount;
}

/** "420.50", "$1,200", "-100" → signed whole cents; null when not money. */
export function parseDollars(text: string): number | null {
  const cleaned = text.trim().replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

interface LineDraft {
  type: 'labor' | 'material';
  description: string;
  quantity: string;
  unitPrice: string;
}

const blankLine = (): LineDraft => ({
  type: 'labor',
  description: '',
  quantity: '1',
  unitPrice: '',
});

export interface JobChangeOrders {
  readonly element: HTMLElement;
  /** The job as last read: decides whether new ones are offered. */
  setJob(job: Job): void;
  dispose(): void;
}

export function mountJobChangeOrders(options: {
  readonly deps: PlatformDeps;
  readonly jobId: string;
  /** After an approval: the job's lines and total have moved. */
  readonly onApplied: () => Promise<unknown> | void;
}): JobChangeOrders {
  const { deps, jobId } = options;
  const cleanups: Cleanup[] = [];
  let rowCleanups: Cleanup[] = [];
  let orders: ChangeOrder[] = [];
  let job: Job | undefined;
  let loadError = '';
  let formOpen = false;
  let busy = false;
  let lines: LineDraft[] = [blankLine()];
  const draft = { title: '', reason: '' };

  const list = el('div', { 'data-testid': 'job-change-orders-list' });
  const closedNote = el(
    'p',
    { 'data-testid': 'job-change-orders-closed', hidden: true },
    'This job is closed to change orders.',
  );
  const propose = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'secondary',
      'data-testid': 'job-change-orders-propose',
    },
    'Propose a change',
  );
  const proposeHost = el('div', {});
  const formHost = el('div', {});
  const error = el('p', {
    role: 'alert',
    'data-testid': 'job-change-orders-error',
    hidden: true,
  });
  const element = el(
    'section',
    {
      'data-bn-detail-section': '',
      'data-testid': 'job-change-orders',
      'aria-labelledby': 'job-change-orders-heading',
    },
    el('h2', { id: 'job-change-orders-heading' }, 'Change orders'),
    closedNote,
    list,
    proposeHost,
    formHost,
    error,
  );

  const showError = (message: string): void => {
    error.textContent = message;
    if (message) error.removeAttribute('hidden');
    else error.setAttribute('hidden', '');
  };
  const messageOf = (err: unknown, fallback: string): string =>
    err instanceof Error && err.message ? err.message : fallback;

  const closed = (): boolean => (job ? CLOSED.has(job.status) : false);
  const canDecide = (): boolean => DECIDERS.has(deps.auth.user()?.role ?? '');

  async function load(): Promise<void> {
    try {
      orders = (await deps.changeOrders.list({ jobId })).data;
      loadError = '';
    } catch (err) {
      loadError = `Could not load change orders: ${messageOf(err, 'try again.')}`;
    }
    render();
  }

  async function decide(
    order: ChangeOrder,
    verb: 'approve' | 'reject',
    note: string,
  ): Promise<void> {
    if (busy) return;
    busy = true;
    showError('');
    try {
      await deps.changeOrders[verb](order.id, note);
      if (verb === 'approve') await options.onApplied();
    } catch (err) {
      showError(messageOf(err, `Could not ${verb} ${order.number}.`));
    } finally {
      busy = false;
    }
    await load();
  }

  function orderRow(order: ChangeOrder): HTMLElement {
    const id = `job-change-order-${order.id}`;
    const row = el(
      'article',
      { 'data-testid': id, 'data-bn-change-order': '' },
      el(
        'header',
        {},
        el('strong', {}, order.number),
        ' ',
        order.title,
        ' ',
        statusBadge(order.status, STATUS_LABEL[order.status]),
        ' ',
        el(
          'span',
          { 'data-testid': `${id}-delta`, 'data-bn-money': '' },
          signedCents(order.priceDelta),
        ),
      ),
      order.reason ? el('p', {}, order.reason) : null,
      el(
        'ul',
        {},
        ...order.lineItems.map((li) =>
          el(
            'li',
            {},
            `${li.description} — ${li.quantity} × ${signedCents(li.unitPrice)}`,
          ),
        ),
      ),
      order.decidedAt
        ? el(
            'p',
            {},
            `${STATUS_LABEL[order.status]} ${new Date(order.decidedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}${order.decisionNote ? ` — ${order.decisionNote}` : ''}`,
          )
        : null,
    );
    if (order.status === 'proposed' && canDecide() && !closed()) {
      const note = el('input', {
        type: 'text',
        'data-bn-input': '',
        'data-testid': `${id}-note`,
        placeholder: 'How the homeowner answered (optional)',
        autocomplete: 'off',
      }) as HTMLInputElement;
      const approve = el(
        'button',
        {
          type: 'button',
          'data-bn-button': '',
          'data-testid': `${id}-approve`,
        },
        'Approve',
      );
      const reject = el(
        'button',
        {
          type: 'button',
          'data-bn-button': '',
          'data-bn-variant': 'secondary',
          'data-testid': `${id}-reject`,
        },
        'Reject',
      );
      rowCleanups.push(
        on(approve, 'click', () => void decide(order, 'approve', note.value)),
        on(reject, 'click', () => void decide(order, 'reject', note.value)),
      );
      row.append(formField('Decision note', note), approve, reject);
    }
    return row;
  }

  function lineFields(line: LineDraft, index: number): HTMLElement {
    const base = `job-change-orders-form-line-${index}`;
    const input = (
      label: string,
      key: 'description' | 'quantity' | 'unitPrice',
      attrs: Record<string, string> = {},
    ): HTMLElement => {
      const node = el('input', {
        type: 'text',
        'data-bn-input': '',
        'data-testid': `${base}-${key}`,
        autocomplete: 'off',
        ...attrs,
      }) as HTMLInputElement;
      node.value = line[key];
      rowCleanups.push(
        on(node, 'input', () => {
          line[key] = node.value;
        }),
      );
      return formField(label, node);
    };
    const type = el('select', {
      'data-bn-input': '',
      'data-testid': `${base}-type`,
    }) as HTMLSelectElement;
    type.append(
      el('option', { value: 'labor' }, 'Labor'),
      el('option', { value: 'material' }, 'Material'),
    );
    type.value = line.type;
    rowCleanups.push(
      on(type, 'change', () => {
        line.type = type.value as LineDraft['type'];
      }),
    );
    return el(
      'div',
      { 'data-bn-field-grid': '' },
      input('Description', 'description'),
      formField('Type', type),
      input('Qty', 'quantity', { inputmode: 'decimal' }),
      input('Unit price ($, negative for a credit)', 'unitPrice', {
        inputmode: 'decimal',
      }),
    );
  }

  function readForm(): ChangeOrderLineInput[] {
    if (!draft.title.trim()) throw new Error('Give the change a title.');
    return lines.map((line, i) => {
      const n = i + 1;
      if (!line.description.trim()) {
        throw new Error(`Line ${n} needs a description.`);
      }
      const quantity = Number(line.quantity.trim() || '1');
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error(`Line ${n} needs a quantity above zero.`);
      }
      const unitPrice = parseDollars(line.unitPrice);
      if (unitPrice === null) {
        throw new Error(`Line ${n} needs a price in dollars, like 420.50.`);
      }
      return {
        type: line.type,
        description: line.description.trim(),
        quantity,
        unitPrice,
      };
    });
  }

  async function submit(): Promise<void> {
    if (busy) return;
    let lineItems: ChangeOrderLineInput[];
    try {
      lineItems = readForm();
    } catch (err) {
      showError(messageOf(err, 'Check the form.'));
      return;
    }
    busy = true;
    showError('');
    try {
      await deps.changeOrders.propose({
        jobId,
        title: draft.title.trim(),
        reason: draft.reason.trim(),
        lineItems,
      });
      formOpen = false;
      lines = [blankLine()];
      draft.title = '';
      draft.reason = '';
    } catch (err) {
      showError(messageOf(err, 'Could not propose this change.'));
      busy = false;
      render();
      return;
    }
    busy = false;
    await load();
  }

  function form(): HTMLElement {
    const text = (label: string, key: 'title' | 'reason'): HTMLElement => {
      const node = el('input', {
        type: 'text',
        'data-bn-input': '',
        'data-testid': `job-change-orders-form-${key}`,
        autocomplete: 'off',
      }) as HTMLInputElement;
      node.value = draft[key];
      rowCleanups.push(
        on(node, 'input', () => {
          draft[key] = node.value;
        }),
      );
      return formField(label, node);
    };
    const addLine = el(
      'button',
      {
        type: 'button',
        'data-bn-button': '',
        'data-bn-variant': 'ghost',
        'data-testid': 'job-change-orders-form-add-line',
      },
      'Add a line',
    );
    const save = el(
      'button',
      {
        type: 'button',
        'data-bn-button': '',
        'data-testid': 'job-change-orders-form-submit',
      },
      'Propose',
    );
    const cancel = el(
      'button',
      {
        type: 'button',
        'data-bn-button': '',
        'data-bn-variant': 'secondary',
        'data-testid': 'job-change-orders-form-cancel',
      },
      'Cancel',
    );
    rowCleanups.push(
      on(addLine, 'click', () => {
        lines.push(blankLine());
        render();
      }),
      on(save, 'click', () => void submit()),
      on(cancel, 'click', () => {
        formOpen = false;
        showError('');
        render();
      }),
    );
    return el(
      'div',
      { 'data-testid': 'job-change-orders-form' },
      text('Title', 'title'),
      text('Why (the homeowner reads this)', 'reason'),
      ...lines.map(lineFields),
      addLine,
      save,
      cancel,
    );
  }

  function render(): void {
    for (const fn of rowCleanups) fn();
    rowCleanups = [];
    clear(list);
    if (loadError) list.append(el('p', {}, loadError));
    else if (orders.length === 0)
      list.append(el('p', {}, 'No change orders yet.'));
    else list.append(...orders.map(orderRow));

    if (closed()) closedNote.removeAttribute('hidden');
    else closedNote.setAttribute('hidden', '');
    // Absent, not hidden, when there is nothing to propose against.
    clear(proposeHost);
    if (!closed() && !formOpen) proposeHost.append(propose);

    clear(formHost);
    if (formOpen && !closed()) formHost.append(form());
  }

  cleanups.push(
    on(propose, 'click', () => {
      formOpen = true;
      showError('');
      render();
    }),
  );

  void load();

  return {
    element,
    setJob(next) {
      job = next;
      render();
    },
    dispose() {
      for (const fn of rowCleanups) fn();
      for (const fn of cleanups) fn();
    },
  };
}
