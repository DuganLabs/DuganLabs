/**
 * Settings page — household profile, income sources, liabilities, Plaid
 * credentials configuration + bank linking.
 *
 * BaseNative-flavored: the credentials state, account list, and status
 * lines all live in signals. Plaid Link drop-in is loaded via the existing
 * cdn.plaid.com script tag in settings.html — that integration is
 * unchanged because the per-vertical Plaid logic is locked-in.
 *
 * TODO (per CLAUDE.md backlog): once `@basenative/integrations/plaid`
 * lands upstream, swap the `window.Plaid.create` call for the BN
 * integration package.
 */
import { signal, effect } from '@basenative/runtime';
import { renderButton } from '@basenative/components';
import { escapeAttr } from '@basenative/runtime/shared/escape';
import type { HouseholdProfile, IncomeSource, Liability } from '@pendingbusiness/core';
import { INCOME_TYPE_LABELS, LIABILITY_TYPE_LABELS } from '@pendingbusiness/core';
import { bindText, bindAttr } from './lib/bind.js';
import { formatTimestamp } from './lib/dates.js';
import { apiFetch } from './lib/auth-fetch.js';
import { errorField, errorMessage } from './lib/api-error.js';
import { withSubmitting } from './lib/forms.js';
import { confirmDialog } from './lib/dialog.js';
import { bindTable, figure, identity, badge, note, type Column } from './lib/table.js';
import { usd, usdOwed, pct, age, DASH } from './lib/format.js';
import {
  editingId,
  fillHouseholdForm,
  fillIncomeForm,
  fillLiabilityForm,
  markInvalid,
  readHouseholdForm,
  readIncomeForm,
  readLiabilityForm,
  type FormRead,
} from './lib/settings-forms.js';

interface PlaidHandler {
  open(): void;
  exit(): void;
  destroy(): void;
}
interface PlaidSuccessMetadata {
  institution: { name: string; institution_id: string } | null;
}
interface PlaidConfig {
  token: string;
  onSuccess: (publicToken: string, metadata: PlaidSuccessMetadata) => void;
  onExit?: (err: unknown) => void;
  onEvent?: (eventName: string) => void;
}
declare global {
  interface Window {
    Plaid?: { create: (config: PlaidConfig) => PlaidHandler };
  }
}

interface AccountRow {
  id: number;
  institution: string | null;
  name: string;
  officialName: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  currentBalance: number | null;
  availableBalance: number | null;
  currency: string | null;
  lastSyncedAt: string | null;
}

type CredsState =
  | { configured: false }
  | { configured: true; clientIdMasked: string; env: string; updatedAt: string };

// ─── state signals ───────────────────────────────────────────

const credsState = signal<CredsState | null>(null);
const accounts = signal<AccountRow[]>([]);
const accountsLoaded = signal<boolean>(false);
const accountsError = signal<string | null>(null);
const credsStatusText = signal<string>('Loading…');
const credsStatusState = signal<'ok' | 'error' | null>(null);
const connectStatusText = signal<string>('');
const connectStatusState = signal<'ok' | 'error' | null>(null);

// ─── element references ──────────────────────────────────────

const credsForm = document.getElementById('plaid-creds-form');
const connectBtn = document.getElementById('btn-connect');
const syncBtn = document.getElementById('btn-sync');

// ─── DOM bindings ────────────────────────────────────────────

bindText('plaid-creds-status', credsStatusText);
bindAttr('plaid-creds-status', 'data-state', () => credsStatusState() ?? null);
bindText('connect-status', connectStatusText);
bindAttr('connect-status', 'data-state', () => connectStatusState() ?? null);

bindText('accounts-meta', () => {
  if (!accountsLoaded()) return DASH;
  const n = accounts().length;
  return n === 0 ? 'none linked' : `${n} linked`;
});

// Drive the connect-button enabled state from the creds signal — pure
// reactive flow, no flag-flipping in handlers.
effect(() => {
  if (!(connectBtn instanceof HTMLButtonElement)) return;
  const c = credsState();
  connectBtn.disabled = !c || c.configured !== true;
});

/**
 * Connected accounts. Same ledger craft as the dashboard: identity column
 * carries the institution and mask, debt balances render negative, and the
 * table foots to a net position (see lib/table.ts / lib/format.ts).
 */
const DEBT_TYPES = new Set(['credit', 'loan']);
const isDebt = (a: AccountRow): boolean => DEBT_TYPES.has(a.type);
const signedBalance = (a: AccountRow): number =>
  isDebt(a) ? -Math.abs(a.currentBalance ?? 0) : (a.currentBalance ?? 0);

bindTable<AccountRow>(
  'accounts-rows',
  {
    caption: 'Balances owed render negative and net into the total.',
    emptyMessage: 'No accounts connected yet — use Connect bank account above.',
    footLabel: 'Net position',
    skeletonRows: 4,
    columns: [
      {
        key: 'name',
        label: 'Account',
        identity: true,
        width: '30%',
        cell: a =>
          identity(
            a.name,
            [a.institution, a.mask ? `····${a.mask}` : null].filter(Boolean).join(' · '),
          ),
      },
      {
        key: 'type',
        label: 'Type',
        width: '18%',
        cell: a =>
          isDebt(a)
            ? badge(a.subtype ?? a.type, 'error')
            : note([a.type, a.subtype].filter(Boolean).join(' / ')),
      },
      {
        key: 'currentBalance',
        label: 'Current',
        numeric: true,
        primary: true,
        width: '18%',
        cell: a =>
          figure(
            a.currentBalance == null ? DASH : usd(signedBalance(a)),
            isDebt(a) ? { tone: 'loss' } : {},
          ),
        foot: rows => figure(usd(rows.reduce((sum, r) => sum + signedBalance(r), 0))),
      },
      {
        key: 'availableBalance',
        label: 'Available',
        numeric: true,
        width: '18%',
        cell: a => figure(a.availableBalance == null ? DASH : usd(a.availableBalance)),
      },
      {
        key: 'lastSyncedAt',
        label: 'Last sync',
        width: '16%',
        cell: a => {
          const { text: when, stale } = age(a.lastSyncedAt);
          return stale ? badge(`stale · ${when}`, 'warning') : note(when);
        },
      },
    ],
  },
  () => {
    if (accountsError()) {
      return { status: 'error', message: accountsError() ?? '', retry: () => void loadAccounts() };
    }
    if (!accountsLoaded()) return { status: 'loading' };
    return { status: 'ready', rows: accounts() };
  },
);

// ─── helpers ────────────────────────────────────────────────

function setCredsStatus(text: string, state: 'ok' | 'error' | null = null): void {
  credsStatusText.set(text);
  credsStatusState.set(state);
}
function setConnectStatus(text: string, state: 'ok' | 'error' | null = null): void {
  connectStatusText.set(text);
  connectStatusState.set(state);
}

async function checkCredentials(): Promise<void> {
  try {
    const res = await apiFetch('/api/plaid/credentials');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as CredsState;
    credsState.set(data);
    if (data.configured) {
      setCredsStatus(
        `Configured · ${data.clientIdMasked} · ${data.env} · updated ${formatTimestamp(data.updatedAt)}`,
        'ok',
      );
    } else {
      setCredsStatus('Not configured — paste credentials below.');
    }
  } catch (err) {
    setCredsStatus(err instanceof Error ? err.message : 'Failed to load.', 'error');
  }
}

if (credsForm instanceof HTMLFormElement) {
  credsForm.addEventListener('submit', async event => {
    event.preventDefault();
    await withSubmitting(credsForm, async () => {
      const data = new FormData(credsForm);
      const body = {
        clientId: String(data.get('clientId') ?? '').trim(),
        secret: String(data.get('secret') ?? '').trim(),
        env: String(data.get('env') ?? 'sandbox'),
      };
      if (!body.clientId || !body.secret) {
        setCredsStatus('Both fields required.', 'error');
        return;
      }
      setCredsStatus('Verifying with Plaid…');
      const res = await apiFetch('/api/plaid/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        credsForm.reset();
        await checkCredentials();
      } else {
        const err = (await res.json().catch(() => null)) as {
          error?: { message?: string; errorCode?: string };
        } | null;
        // `error.code` is our own wrapper code (always INVALID_CREDENTIALS
        // for this route); `error.errorCode` is Plaid's own error_code, and
        // only INVALID_API_KEYS is actually about the secret — Plaid's
        // other 400s (e.g. a malformed client_id) aren't fixed by
        // re-checking it, so the hint stayed off for those.
        const message = err?.error?.message ?? `Couldn't save (HTTP ${res.status}).`;
        const hint =
          err?.error?.errorCode === 'INVALID_API_KEYS'
            ? ' (check that you copied the secret for the selected environment)'
            : '';
        setCredsStatus(`${message}${hint}`, 'error');
      }
    });
  });
}

async function openPlaidLink(): Promise<void> {
  setConnectStatus('Creating link token…');
  const res = await apiFetch('/api/plaid/link-token', { method: 'POST' });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    setConnectStatus(
      err?.error?.message ?? `Couldn't create link token (HTTP ${res.status}).`,
      'error',
    );
    return;
  }
  const { linkToken } = (await res.json()) as { linkToken: string };
  if (!window.Plaid) {
    setConnectStatus('Plaid Link script did not load.', 'error');
    return;
  }
  const handler = window.Plaid.create({
    token: linkToken,
    onSuccess: async (publicToken, metadata) => {
      setConnectStatus(`Connecting ${metadata.institution?.name ?? 'bank'}…`);
      const exchange = await apiFetch('/api/plaid/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicToken }),
      });
      if (exchange.ok) {
        const data = (await exchange.json()) as {
          institutionName: string | null;
          accountsAdded: number;
        };
        setConnectStatus(
          `Connected ${data.institutionName ?? 'institution'} · ${data.accountsAdded} accounts added.`,
          'ok',
        );
        await loadAccounts();
      } else {
        const err = (await exchange.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setConnectStatus(
          err?.error?.message ?? `Couldn't connect (HTTP ${exchange.status}).`,
          'error',
        );
      }
    },
    onExit: (err: unknown) => {
      if (err) setConnectStatus('Plaid Link exited.', 'error');
    },
  });
  handler.open();
}

if (connectBtn) connectBtn.addEventListener('click', () => void openPlaidLink());

if (syncBtn) {
  syncBtn.addEventListener('click', async () => {
    setConnectStatus('Syncing…');
    const res = await apiFetch('/api/plaid/sync', { method: 'POST' });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setConnectStatus(err?.error?.message ?? `Sync failed (HTTP ${res.status}).`, 'error');
      return;
    }
    const data = (await res.json()) as {
      ok: boolean;
      itemsSynced: number;
      accountsUpdated: number;
      errors?: Array<{ itemId: number; message: string }>;
    };
    if (data.errors && data.errors.length > 0) {
      const first = data.errors[0]?.message ?? 'unknown';
      setConnectStatus(
        `Synced ${data.itemsSynced} items, ${data.errors.length} failed: ${first}`,
        'error',
      );
    } else {
      setConnectStatus(
        `Synced ${data.itemsSynced} items, updated ${data.accountsUpdated} accounts.`,
        'ok',
      );
    }
    await loadAccounts();
  });
}

async function loadAccounts(): Promise<void> {
  accountsError.set(null);
  try {
    const res = await apiFetch('/api/plaid/accounts');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { accounts: AccountRow[] };
    accounts.set(data.accounts);
  } catch (err) {
    accounts.set([]);
    const detail = err instanceof Error ? ` (${err.message})` : '';
    accountsError.set(`Couldn't load connected accounts${detail}.`);
  } finally {
    accountsLoaded.set(true);
  }
}

// ─── household profile ───────────────────────────────────────
// The six users.* columns from 0006_household_profile.sql. Every figure on
// the dashboard is computed from these, so the status line says so when a
// save lands.

type StatusState = 'ok' | 'error' | null;

const householdForm = document.getElementById('household-form');
const householdStatusText = signal<string>('Loading…');
const householdStatusState = signal<StatusState>(null);
bindText('household-status', householdStatusText);
bindAttr('household-status', 'data-state', () => householdStatusState() ?? null);

function setHouseholdStatus(text: string, state: StatusState = null): void {
  householdStatusText.set(text);
  householdStatusState.set(state);
}

async function loadHousehold(): Promise<void> {
  if (!(householdForm instanceof HTMLFormElement)) return;
  try {
    const res = await apiFetch('/api/household');
    if (!res.ok) throw new Error(await errorMessage(res));
    const { household } = (await res.json()) as { household: HouseholdProfile };
    fillHouseholdForm(householdForm, household);
    setHouseholdStatus('');
  } catch (err) {
    setHouseholdStatus(
      err instanceof Error ? `Couldn't load your household (${err.message}).` : "Couldn't load.",
      'error',
    );
  }
}

if (householdForm instanceof HTMLFormElement) {
  householdForm.addEventListener('submit', async event => {
    event.preventDefault();
    await withSubmitting(householdForm, async () => {
      const read = readHouseholdForm(householdForm);
      if (!read.ok) {
        setHouseholdStatus(read.message, 'error');
        (markInvalid(householdForm, read.field) as HTMLElement | null)?.focus();
        return;
      }
      markInvalid(householdForm, null);
      setHouseholdStatus('Saving…');
      const res = await apiFetch('/api/household', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(read.body),
      });
      if (!res.ok) {
        setHouseholdStatus(await errorMessage(res), 'error');
        (markInvalid(householdForm, await errorField(res)) as HTMLElement | null)?.focus();
        return;
      }
      const { household } = (await res.json()) as { household: HouseholdProfile };
      fillHouseholdForm(householdForm, household);
      setHouseholdStatus('Saved. The dashboard now runs on these figures.', 'ok');
    });
  });
}

// ─── income sources + liabilities ────────────────────────────
// Two ledgers with the same life: list, add, edit in place, delete. One
// form each does both add and edit — its hidden `id` says which — so the
// wiring is shared and only the columns and the form readers differ.

interface Ledger<T extends { id: number }> {
  noun: string;
  endpoint: string;
  /** The key the worker's list envelope and single-row envelope use. */
  listKey: string;
  rowKey: string;
  rowsId: string;
  formId: string;
  statusId: string;
  caption: string;
  emptyMessage: string;
  columns: Column<T>[];
  fill: (form: HTMLFormElement, row: T | null) => void;
  read: (form: HTMLFormElement) => FormRead<unknown>;
  /** One line for the delete confirmation. */
  describe: (row: T) => string;
}

function actionsColumn<T extends { id: number; label: string }>(noun: string): Column<T> {
  // A cell is an HTML string and `bindTable` rewrites the container on every
  // run, so no listener can live here — the row id rides on a data attribute
  // and one delegated click handler in `wireLedger` picks it up.
  return {
    key: 'actions',
    label: 'Actions',
    width: '20%',
    cell: row =>
      renderButton('Edit', {
        variant: 'secondary',
        size: 'sm',
        attrs: `data-edit="${escapeAttr(String(row.id))}" aria-label="Edit ${noun} ${escapeAttr(row.label)}"`,
      }) +
      renderButton('Delete', {
        variant: 'destructive',
        size: 'sm',
        attrs: `data-delete="${escapeAttr(String(row.id))}" aria-label="Delete ${noun} ${escapeAttr(row.label)}"`,
      }),
  };
}

function wireLedger<T extends { id: number; label: string }>(
  ledger: Ledger<T>,
): () => Promise<void> {
  const rows = signal<T[]>([]);
  const loaded = signal(false);
  const loadError = signal<string | null>(null);
  const statusText = signal('');
  const statusState = signal<StatusState>(null);
  const rowsEl = document.getElementById(ledger.rowsId);
  const form = document.getElementById(ledger.formId);

  bindText(ledger.statusId, statusText);
  bindAttr(ledger.statusId, 'data-state', () => statusState() ?? null);
  const setStatus = (text: string, state: StatusState = null): void => {
    statusText.set(text);
    statusState.set(state);
  };

  async function load(): Promise<void> {
    loadError.set(null);
    try {
      const res = await apiFetch(ledger.endpoint);
      if (!res.ok) throw new Error(await errorMessage(res));
      const data = (await res.json()) as Record<string, T[]>;
      rows.set(data[ledger.listKey] ?? []);
    } catch (err) {
      rows.set([]);
      loadError.set(
        `Couldn't load ${ledger.noun}s${err instanceof Error ? ` (${err.message})` : ''}.`,
      );
    } finally {
      loaded.set(true);
    }
  }

  bindTable<T>(
    rowsEl,
    {
      caption: ledger.caption,
      emptyMessage: ledger.emptyMessage,
      skeletonRows: 3,
      columns: [...ledger.columns, actionsColumn<T>(ledger.noun)],
    },
    () => {
      if (loadError())
        return { status: 'error', message: loadError() ?? '', retry: () => void load() };
      if (!loaded()) return { status: 'loading' };
      return { status: 'ready', rows: rows() };
    },
  );

  if (!(form instanceof HTMLFormElement)) return load;
  const cancel = form.querySelector<HTMLButtonElement>('button[type="button"]');

  const startEditing = (row: T | null): void => {
    ledger.fill(form, row);
    markInvalid(form, null);
    if (cancel) cancel.hidden = row === null;
    if (row) {
      setStatus(`Editing ${row.label}.`);
      form.querySelector<HTMLElement>('input:not([type="hidden"]), select')?.focus();
    }
  };

  cancel?.addEventListener('click', () => {
    startEditing(null);
    setStatus('');
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    await withSubmitting(form, async () => {
      const read = ledger.read(form);
      if (!read.ok) {
        setStatus(read.message, 'error');
        (markInvalid(form, read.field) as HTMLElement | null)?.focus();
        return;
      }
      markInvalid(form, null);
      const id = editingId(form);
      setStatus('Saving…');
      const res = await apiFetch(
        id ? `${ledger.endpoint}/${encodeURIComponent(String(id))}` : ledger.endpoint,
        {
          method: id ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(read.body),
        },
      );
      if (!res.ok) {
        setStatus(await errorMessage(res), 'error');
        (markInvalid(form, await errorField(res)) as HTMLElement | null)?.focus();
        return;
      }
      const data = (await res.json()) as Record<string, T>;
      const saved = data[ledger.rowKey];
      startEditing(null);
      setStatus(
        `${id ? 'Updated' : 'Added'} ${saved?.label ?? ledger.noun}. The dashboard now uses it.`,
        'ok',
      );
      await load();
    });
  });

  rowsEl?.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const edit = target.closest<HTMLButtonElement>('[data-edit]');
    if (edit) {
      const row = rows().find(r => r.id === Number(edit.dataset.edit));
      if (row) startEditing(row);
      return;
    }
    const del = target.closest<HTMLButtonElement>('[data-delete]');
    if (!del) return;
    const id = Number(del.dataset.delete);
    const row = rows().find(r => r.id === id);
    if (!row) return;
    void (async () => {
      const ok = await confirmDialog({
        title: `Delete this ${ledger.noun}?`,
        body: `${ledger.describe(row)} This cannot be undone, and the dashboard will stop counting it.`,
        confirmLabel: 'Delete',
        cancelLabel: 'Keep',
        destructive: true,
      });
      if (!ok) return;
      del.disabled = true;
      try {
        const res = await apiFetch(`${ledger.endpoint}/${encodeURIComponent(String(id))}`, {
          method: 'DELETE',
        });
        if (!res.ok) {
          setStatus(`Couldn't delete ${row.label}: ${await errorMessage(res)}`, 'error');
          return;
        }
        if (editingId(form) === id) startEditing(null);
        setStatus(`Deleted ${row.label}.`, 'ok');
      } catch (err) {
        setStatus(
          err instanceof Error ? `Couldn't delete: ${err.message}` : 'Network error. Try again.',
          'error',
        );
      } finally {
        del.disabled = false;
        void load();
      }
    })();
  });

  return load;
}

const loadIncome = wireLedger<IncomeSource>({
  noun: 'income source',
  endpoint: '/api/income-sources',
  listKey: 'incomeSources',
  rowKey: 'incomeSource',
  rowsId: 'income-rows',
  formId: 'income-form',
  statusId: 'income-status',
  caption: 'Annual gross by source.',
  emptyMessage: 'No income sources yet — add one below.',
  columns: [
    {
      key: 'label',
      label: 'Source',
      identity: true,
      width: '32%',
      cell: s => identity(s.label, s.employer ?? undefined),
    },
    {
      key: 'type',
      label: 'Type',
      width: '18%',
      cell: s => note(INCOME_TYPE_LABELS[s.type] ?? s.type),
    },
    {
      key: 'grossAnnual',
      label: 'Gross / yr',
      numeric: true,
      primary: true,
      width: '18%',
      cell: s => figure(usd(s.grossAnnual)),
    },
    {
      key: 'has401kMatch',
      label: '401(k)',
      width: '12%',
      cell: s => (s.has401kMatch ? badge('match', 'success') : note(DASH)),
    },
  ],
  fill: fillIncomeForm,
  read: readIncomeForm,
  describe: s => `${s.label} (${usd(s.grossAnnual)} / yr) will be removed.`,
});

const loadLiabilities = wireLedger<Liability>({
  noun: 'liability',
  endpoint: '/api/liabilities',
  listKey: 'liabilities',
  rowKey: 'liability',
  rowsId: 'liability-rows',
  formId: 'liability-form',
  statusId: 'liabilities-status',
  caption: 'Priority first, then highest APR — the avalanche order.',
  emptyMessage: 'No liabilities yet — add one below.',
  columns: [
    {
      key: 'label',
      label: 'Liability',
      identity: true,
      width: '28%',
      cell: l => identity(l.label, LIABILITY_TYPE_LABELS[l.type] ?? l.type),
    },
    {
      key: 'principal',
      label: 'Principal',
      numeric: true,
      primary: true,
      width: '16%',
      cell: l => figure(usdOwed(l.principal)),
    },
    {
      key: 'rateApr',
      label: 'APR',
      numeric: true,
      width: '12%',
      cell: l => figure(pct(l.rateApr)),
    },
    {
      key: 'minPaymentMonthly',
      label: 'Min / mo',
      numeric: true,
      width: '14%',
      cell: l => figure(usd(l.minPaymentMonthly)),
    },
    {
      key: 'priority',
      label: 'Priority',
      numeric: true,
      width: '10%',
      cell: l => figure(String(l.priority)),
    },
  ],
  fill: fillLiabilityForm,
  read: readLiabilityForm,
  describe: l => `${l.label} (${usd(l.principal)} at ${pct(l.rateApr)}) will be removed.`,
});

void loadHousehold();
void loadIncome();
void loadLiabilities();
void checkCredentials();
void loadAccounts();
