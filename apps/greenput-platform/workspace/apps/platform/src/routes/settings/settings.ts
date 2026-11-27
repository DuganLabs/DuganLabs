/**
 * `/settings` — workspace control panel with 9 tabs.
 *
 * Mirrors [SettingsComponent](apps/platform/src/app/features/settings/settings.component.ts).
 *
 *   workspace     — name, trade, contact, address, license number
 *   availability  — weekly hours, dated exceptions, time zone and the four
 *                   booking numbers (GP-101); the only screen that can make a
 *                   contractor bookable, reachable as `/settings?tab=availability`
 *   notifications — event/channel toggle matrix
 *   team          — list of users + invite + role change + remove
 *   billing       — Stripe subscription, lead-fee charges, SMS usage balance, and Connect onboarding
 *   webhooks      — list + create + toggle + delete
 *   branding      — colors, font, email footer
 *   api-keys      — list + create (rawKey returned once) + delete
 *   security      — passkey enrollment via @basenative/auth-webauthn, plus
 *                   the personal recovery number that is the only way back
 *                   into an account once every passkey is gone
 */

import { effect, signal } from '@basenative/runtime';
import { createResource } from '@basenative/fetch';
import {
  createWebAuthnClient,
  PASSKEY_PROMPT_TIMEOUT_MS,
  withTimeout,
} from '@basenative/auth-webauthn';
import { TWILIO_US_SMS_SEGMENT_MICRO_USD } from '@greenput/shared/notifications';
import { toE164 } from '@greenput/shared/utils';
import type {
  Branding,
  CustomDomain,
  NotificationChannel,
  NotificationEventType,
  NotificationPreference,
  Subscription,
  UserRole,
  Webhook,
  Workspace,
  WorkspaceAvailability,
  WorkspaceUser,
} from '@greenput/shared/models';
import type {
  ConnectStatus,
  LeadFeeCharge,
  LeadFeeMeter,
  UsageBalance,
  UsageLedgerEntry,
} from '../../api/billing.js';
import type { ApiKey } from '../../api/api-keys.js';
import type { PlatformDeps } from '../../deps.js';
import { adoptSheet, defineSheet } from '../../styles/sheet.js';
import { LIST_ROUTE_SHEET } from '../../styles/list-route.js';
import { clear, delegate, el, on, type Cleanup } from '../../lib/dom.js';
import { statusBadge } from '../shared/badge.js';
import { field as formField } from '../shared/field.js';
import {
  actionButton,
  fill,
  mountTable,
  onRowAction,
  type TableColumn,
} from '../shared/table.js';
import { SHARE_LINK_SHEET, mountShareLink } from '../shared/share-link.js';
import type { RouteView } from '../types.js';

type TabId =
  | 'workspace'
  | 'availability'
  | 'notifications'
  | 'team'
  | 'billing'
  | 'webhooks'
  | 'branding'
  | 'api-keys'
  | 'security';

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'availability', label: 'Availability' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'team', label: 'Team' },
  { id: 'billing', label: 'Billing' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'branding', label: 'Branding' },
  { id: 'api-keys', label: 'API Keys' },
  { id: 'security', label: 'Security' },
];

/**
 * The tab a URL asks for: `/settings?tab=availability`. Read once at render —
 * the route is re-rendered on navigation, so there is nothing to subscribe
 * to. Anything unrecognised opens the first tab, as a bare `/settings` does.
 * Onboarding links here, because the hours are the one thing signup does not
 * collect and the one thing that makes a contractor bookable.
 */
export function readSettingsTab(search: string): TabId {
  const wanted = new URLSearchParams(search).get('tab');
  const match = TABS.find((t) => t.id === wanted);
  return match ? match.id : 'workspace';
}

const NOTIFICATION_EVENTS: ReadonlyArray<{
  type: NotificationEventType;
  label: string;
}> = [
  { type: 'new_lead', label: 'New lead' },
  { type: 'job_status_change', label: 'Job status changed' },
  { type: 'payment_received', label: 'Payment received' },
  { type: 'review_request', label: 'Review request' },
];

const NOTIFICATION_CHANNELS: NotificationChannel[] = ['email', 'sms', 'push'];

const ROLES: UserRole[] = ['owner', 'admin', 'tech', 'office'];

/** Checkbox painted as an Apple 27 switch. `aria-checked` follows `.checked`. */
function bindSwitch(input: HTMLInputElement): HTMLInputElement {
  input.setAttribute('data-bn', 'bn-switch-input');
  input.setAttribute('role', 'switch');
  const sync = (): void => {
    input.setAttribute('aria-checked', input.checked ? 'true' : 'false');
  };
  sync();
  input.addEventListener('change', sync);
  return input;
}

const SETTINGS_SHEET = defineSheet(`
[data-bn-settings] {
  display: grid;
  grid-template-columns: 14rem 1fr;
  gap: var(--gp-space-5);
}
[data-bn-settings-tabs] {
  display: grid;
  gap: var(--gp-space-1);
  align-content: start;
  position: sticky;
  inset-block-start: var(--gp-space-5);
}
[data-bn-settings-tab] {
  text-align: start;
  padding: var(--gp-space-2) var(--gp-space-3);
  border-radius: var(--gp-radius-md);
  background: transparent;
  border: 1px solid transparent;
  font: inherit;
  cursor: pointer;
  color: var(--gp-text-muted);
}
[data-bn-settings-tab]:hover { background: var(--gp-surface-sunk); color: var(--gp-text); }
[data-bn-settings-tab][data-bn-active] {
  background: var(--gp-primary-tint);
  color: var(--gp-primary);
  font-weight: 600;
}
[data-bn-settings-panel] {
  background: var(--gp-surface);
  border-radius: var(--gp-radius-lg);
  padding: var(--gp-space-6);
  box-shadow: var(--gp-shadow-sm);
  display: grid;
  gap: var(--gp-space-4);
}
[data-bn-settings-panel] h2 {
  margin: 0;
  font-family: var(--gp-font-display);
  font-size: var(--gp-text-xl);
}
[data-bn-settings-panel] h3 {
  margin: 0;
  font-size: var(--gp-text-lg);
}
[data-bn-saved] {
  display: inline-flex;
  align-items: center;
  gap: var(--gp-space-2);
  padding: var(--gp-space-1) var(--gp-space-3);
  background: var(--gp-good-bg);
  color: var(--gp-success);
  border-radius: var(--gp-radius-full);
  font-size: var(--gp-text-sm);
}
[data-bn-saved][hidden] { display: none; }
[data-bn-notification-grid] {
  display: grid;
  grid-template-columns: 1fr repeat(3, auto);
  gap: var(--gp-space-2) var(--gp-space-4);
  align-items: center;
}
[data-bn-notification-grid] [data-bn-header] {
  font-weight: 600;
  font-size: var(--gp-text-xs);
  text-transform: uppercase;
  color: var(--gp-text-muted);
}
[data-bn-team-grid] { display: grid; gap: var(--gp-space-2); }
[data-bn-team-row] {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: var(--gp-space-3);
  padding: var(--gp-space-2);
  border: 1px solid var(--gp-rule);
  border-radius: var(--gp-radius-md);
}
[data-bn-team-row] [data-bn-avatar] {
  background: var(--gp-primary);
  color: var(--gp-primary-fg);
  width: 2rem;
  height: 2rem;
  border-radius: var(--gp-radius-full);
  display: grid;
  place-items: center;
  font-weight: 600;
  font-size: var(--gp-text-sm);
}
[data-bn-color-row] {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: var(--gp-space-3);
}
[data-bn-color-swatch] {
  display: flex;
  align-items: center;
  gap: var(--gp-space-2);
}
[data-bn-color-swatch] input[type='color'] {
  width: 2.5rem;
  height: 2.5rem;
  padding: 0;
  border: 1px solid var(--gp-rule);
  border-radius: var(--gp-radius-md);
  background: none;
}
[data-bn-key-row] {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  align-items: center;
  gap: var(--gp-space-3);
  padding: var(--gp-space-3);
  border: 1px solid var(--gp-rule);
  border-radius: var(--gp-radius-md);
}
[data-bn-key-row] code {
  font-family: ui-monospace, SFMono-Regular, monospace;
  background: var(--gp-surface-sunk);
  padding: 2px var(--gp-space-2);
  border-radius: var(--gp-radius-sm);
}
[data-bn-toggle] {
  display: inline-flex;
  align-items: center;
  gap: var(--gp-space-2);
  min-block-size: var(--gp-tap-min);
  min-inline-size: var(--gp-tap-min);
}
[data-bn-availability-form] { display: grid; gap: var(--gp-space-5); }
[data-bn-availability-section] {
  border: 1px solid var(--gp-rule);
  border-radius: var(--gp-radius-md);
  padding: var(--gp-space-4);
  display: grid;
  gap: var(--gp-space-3);
  min-inline-size: 0;
}
[data-bn-availability-section] legend {
  font-weight: 600;
  padding: 0 var(--gp-space-2);
}
[data-bn-availability-notice] {
  display: block;
  padding: var(--gp-space-2) var(--gp-space-3);
  border-radius: var(--gp-radius-md);
  font-size: var(--gp-text-sm);
}
[data-bn-availability-notice][data-bn-tone='warn'] {
  background: var(--gp-warn-bg, var(--gp-surface-sunk));
  color: var(--gp-warning, var(--gp-text));
}
[data-bn-availability-notice][data-bn-tone='good'] {
  background: var(--gp-good-bg);
  color: var(--gp-success);
}
[data-bn-availability-week] {
  display: grid;
  grid-template-columns: 1fr auto minmax(6rem, 1fr) minmax(6rem, 1fr);
  gap: var(--gp-space-2) var(--gp-space-3);
  align-items: center;
}
[data-bn-availability-week] [data-bn-header] {
  font-weight: 600;
  font-size: var(--gp-text-xs);
  text-transform: uppercase;
  color: var(--gp-text-muted);
}
[data-bn-availability-week] input[type='time']:disabled { opacity: 0.5; }
[data-bn-availability-exceptions] {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--gp-space-2);
}
[data-bn-availability-exception] {
  display: grid;
  grid-template-columns: auto auto 1fr auto;
  align-items: center;
  gap: var(--gp-space-3);
  padding: var(--gp-space-2);
  border: 1px solid var(--gp-rule);
  border-radius: var(--gp-radius-md);
}
[data-bn-availability-add] {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  gap: var(--gp-space-3);
  align-items: end;
}
@media (max-width: 720px) {
  [data-bn-availability-week] { grid-template-columns: 1fr auto; }
  [data-bn-availability-exception] { grid-template-columns: 1fr auto; }
}
@media (max-width: 720px) {
  [data-bn-settings] { grid-template-columns: 1fr; }
  [data-bn-settings-tabs] {
    display: flex;
    overflow-x: auto;
    flex-wrap: nowrap;
    position: static;
  }
  [data-bn-settings-tab] { white-space: nowrap; }
}
`);

export function renderSettingsRoute(deps: PlatformDeps): RouteView {
  adoptSheet(LIST_ROUTE_SHEET);
  adoptSheet(SHARE_LINK_SHEET);
  adoptSheet(SETTINGS_SHEET);

  const initialTab = readSettingsTab(window.location.search);
  const tab = signal<TabId>(initialTab);
  const cleanups: Cleanup[] = [];

  const header = el(
    'header',
    {},
    el(
      'div',
      {},
      el('h1', {}, 'Settings'),
      el(
        'p',
        {},
        'Workspace, availability, team, billing, notifications, branding, API keys, and security.',
      ),
    ),
  );

  // ── tabs ───────────────────────────────────────────────────────────────
  const tabList = el('nav', { 'data-bn-settings-tabs': '', role: 'tablist' });
  function renderTabs(active: TabId): void {
    clear(tabList);
    for (const t of TABS) {
      const btn = el(
        'button',
        {
          type: 'button',
          'data-bn-settings-tab': '',
          'data-testid': `settings-tab-${t.id}`,
          role: 'tab',
          'aria-selected': active === t.id ? 'true' : 'false',
        },
        t.label,
      );
      if (active === t.id) btn.setAttribute('data-bn-active', '');
      btn.addEventListener('click', () => tab.set(t.id));
      tabList.append(btn);
    }
  }
  renderTabs(initialTab);
  cleanups.push(
    effect(() => {
      renderTabs(tab());
    }).dispose,
  );

  // ── panel slot ─────────────────────────────────────────────────────────
  const panelSlot = el('section', {
    'data-bn-settings-panel': '',
    role: 'tabpanel',
    'data-testid': 'settings-panel',
  });

  // Each tab's render function. Returns dispose so we can clean up its
  // resources when switching tabs.
  let activeDispose: Cleanup | null = null;
  function mountTab(id: TabId): void {
    activeDispose?.();
    activeDispose = null;
    clear(panelSlot);
    panelSlot.setAttribute('aria-labelledby', `settings-tab-${id}`);
    const tabFns: Record<TabId, () => { node: Node; dispose?: Cleanup }> = {
      workspace: () => renderWorkspacePanel(deps),
      availability: () => renderAvailabilityPanel(deps),
      notifications: () => renderNotificationsPanel(deps),
      team: () => renderTeamPanel(deps),
      billing: () => renderBillingPanel(deps),
      webhooks: () => renderWebhooksPanel(deps),
      branding: () => renderBrandingPanel(deps),
      'api-keys': () => renderApiKeysPanel(deps),
      security: () => renderSecurityPanel(deps),
    };
    const result = tabFns[id]();
    panelSlot.append(result.node);
    if (result.dispose) activeDispose = result.dispose;
  }
  mountTab(initialTab);
  cleanups.push(
    effect(() => {
      mountTab(tab());
    }).dispose,
  );

  const root = el(
    'section',
    { 'data-bn-list-route': '', 'data-bn-route': 'settings' },
    header,
    el('div', { 'data-bn-settings': '' }, tabList, panelSlot),
  );

  return {
    element: root,
    dispose: () => {
      activeDispose?.();
      for (const fn of cleanups) fn();
    },
  };
}

// ── Workspace panel ─────────────────────────────────────────────────────
function renderWorkspacePanel(deps: PlatformDeps): {
  node: Node;
  dispose: Cleanup;
} {
  const cleanups: Cleanup[] = [];
  const resource = createResource<{ data: Workspace }>(
    () => deps.workspace.get(),
    { auto: true },
  );

  type Form = {
    name: string;
    trade: string;
    phone: string;
    email: string;
    street: string;
    city: string;
    state: string;
    zip: string;
    licenseNumber: string;
    /** Kept as typed; sent as `serviceArea`, null when blank (GP-039). */
    serviceArea: string;
    /** Kept as typed; sent as `serviceRadiusMiles`, null when blank. */
    serviceRadiusMiles: string;
  };

  const form = signal<Form>({
    name: '',
    trade: '',
    phone: '',
    email: '',
    street: '',
    city: '',
    state: '',
    zip: '',
    licenseNumber: '',
    serviceArea: '',
    serviceRadiusMiles: '',
  });
  const saving = signal(false);
  const saved = signal(false);
  const error = signal<string | null>(null);

  const fields = el('div', { 'data-bn-field-grid': '' });
  const inputs = new Map<keyof Form, HTMLInputElement>();
  const make = (
    label: string,
    field: keyof Form,
    attrs: Record<string, string> = { type: 'text' },
  ): HTMLElement => {
    const input = el('input', {
      ...attrs,
      'data-bn-input': '',
      'data-testid': `settings-workspace-${field}`,
    }) as HTMLInputElement;
    inputs.set(field, input);
    on(input, 'input', () => {
      form.set({ ...form.peek(), [field]: input.value });
    });
    return formField(label, input);
  };
  fields.append(
    make('Name', 'name'),
    make('Trade', 'trade'),
    make('Phone', 'phone'),
    make('Email', 'email'),
    make('Street', 'street'),
    make('City', 'city'),
    make('State', 'state'),
    make('ZIP', 'zip'),
    make('License number', 'licenseNumber'),
    // Where the contractor works (GP-039). Onboarding asks for both and
    // stores them; this is where they get changed.
    make('Service area', 'serviceArea', {
      type: 'text',
      placeholder: 'City or region',
    }),
    make('Service radius (miles)', 'serviceRadiusMiles', {
      type: 'number',
      min: '1',
      max: '500',
      step: '1',
      inputmode: 'numeric',
    }),
  );

  cleanups.push(
    effect(() => {
      const ws = resource.data()?.data;
      if (!ws) return;
      // Read the declared `Workspace` shape, not a guess at it. This used to
      // pluck flat `street`/`city` keys out of the raw body — which happened
      // to work while the API answered with D1 rows — and to look for
      // `license_number`, a key neither shape has ever had (the column is
      // `license_num`, the field is `licenseNumber`), so the License number
      // box was always empty.
      const next: Form = {
        name: ws.name ?? '',
        trade: ws.trade ?? '',
        phone: ws.phone ?? '',
        email: ws.email ?? '',
        street: ws.address?.street ?? '',
        city: ws.address?.city ?? '',
        state: ws.address?.state ?? '',
        zip: ws.address?.zip ?? '',
        licenseNumber: ws.licenseNumber ?? '',
        serviceArea: ws.serviceArea ?? '',
        serviceRadiusMiles:
          ws.serviceRadiusMiles === undefined
            ? ''
            : String(ws.serviceRadiusMiles),
      };
      form.set(next);
      for (const [key, input] of inputs) input.value = next[key];
    }).dispose,
  );

  const saveBtn = el(
    'button',
    {
      type: 'submit',
      'data-bn-button': '',
      'data-bn-variant': 'primary',
      'data-testid': 'settings-workspace-save',
    },
    'Save changes',
  );
  cleanups.push(
    effect(() => {
      saveBtn.disabled = saving();
      saveBtn.textContent = saving() ? 'Saving…' : 'Save changes';
    }).dispose,
  );

  const savedNode = el(
    'span',
    { 'data-bn-saved': '', hidden: true, role: 'status' },
    'Saved',
  );
  cleanups.push(
    effect(() => {
      if (saved()) savedNode.removeAttribute('hidden');
      else savedNode.setAttribute('hidden', '');
    }).dispose,
  );

  const errorNode = el('output', {
    'data-bn-error': '',
    role: 'alert',
    hidden: true,
  });
  cleanups.push(
    effect(() => {
      const m = error();
      if (m) {
        errorNode.textContent = m;
        errorNode.removeAttribute('hidden');
      } else {
        errorNode.setAttribute('hidden', '');
      }
    }).dispose,
  );

  const formEl = el(
    'form',
    { 'data-bn-workspace-form': '' },
    fields,
    errorNode,
    el('footer', { 'data-bn-form-footer': '' }, savedNode, saveBtn),
  );
  cleanups.push(
    on(formEl, 'submit', async (event) => {
      event.preventDefault();
      saving.set(true);
      saved.set(false);
      error.set(null);
      try {
        const f = form.peek();
        await deps.workspace.update({
          name: f.name,
          trade: f.trade,
          phone: f.phone,
          email: f.email,
          address: {
            street: f.street,
            city: f.city,
            state: f.state,
            zip: f.zip,
          },
          ...(f.licenseNumber ? { licenseNumber: f.licenseNumber } : {}),
          // Blank clears, on purpose: null is how the API un-sets a nullable
          // column, and a contractor who empties the box means it.
          serviceArea: f.serviceArea.trim() || null,
          serviceRadiusMiles: f.serviceRadiusMiles.trim()
            ? Number(f.serviceRadiusMiles)
            : null,
        });
        saved.set(true);
        setTimeout(() => saved.set(false), 2500);
      } catch (err) {
        error.set(
          err instanceof Error ? err.message : 'Could not save workspace.',
        );
      } finally {
        saving.set(false);
      }
    }),
  );

  const node = el(
    'div',
    {},
    el('h2', {}, 'Workspace'),
    el('p', { 'data-bn-secondary': '' }, 'Public details about your business.'),
    formEl,
  );

  return {
    node,
    dispose: () => {
      resource.dispose();
      for (const fn of cleanups) fn();
    },
  };
}

// ── Availability panel (GP-101) ─────────────────────────────────────────
//
// The only screen in the product that can make a contractor bookable. Seven
// rows of open/close with an is-open toggle, the dated exceptions, the time
// zone, and the four booking numbers — saved together with one PUT, because
// the Worker treats a partial week as no state at all. Until a time zone is
// set and at least one day is open the panel says, in words, that nothing can
// be booked: an absent answer must not read as "always open".

/** Display order Monday-first; the value is `Date.getDay()` (0 = Sunday). */
const WEEKDAY_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_NAMES: readonly string[] = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const DEFAULT_OPENS = '08:00';
const DEFAULT_CLOSES = '17:00';

interface DayForm {
  weekday: number;
  isOpen: boolean;
  opensAt: string;
  closesAt: string;
}

interface ExceptionForm {
  date: string;
  isOpen: boolean;
  opensAt: string;
  closesAt: string;
  reason: string;
}

interface PolicyForm {
  timezone: string;
  bookingLeadHours: number;
  bookingHorizonDays: number;
  travelBufferMinutes: number;
  concurrentJobs: number;
}

/** A week with nothing open, so the first click on any day is "open it". */
function emptyWeek(): DayForm[] {
  return WEEKDAY_ORDER.map((weekday) => ({
    weekday,
    isOpen: false,
    opensAt: DEFAULT_OPENS,
    closesAt: DEFAULT_CLOSES,
  }));
}

/** The browser's own zone list when it has one; the box still accepts typing. */
function knownTimeZones(): string[] {
  const intl = Intl as unknown as {
    supportedValuesOf?: (key: string) => string[];
  };
  try {
    return intl.supportedValuesOf?.('timeZone') ?? [];
  } catch {
    return [];
  }
}

function renderAvailabilityPanel(deps: PlatformDeps): {
  node: Node;
  dispose: Cleanup;
} {
  const cleanups: Cleanup[] = [];
  const resource = createResource<{ data: WorkspaceAvailability }>(
    () => deps.availability.get(),
    { auto: true },
  );

  const week = signal<DayForm[]>(emptyWeek());
  const exceptions = signal<ExceptionForm[]>([]);
  const policy = signal<PolicyForm>({
    timezone: '',
    bookingLeadHours: 24,
    bookingHorizonDays: 30,
    travelBufferMinutes: 30,
    concurrentJobs: 1,
  });
  const bookable = signal(false);
  const saving = signal(false);
  const saved = signal(false);
  const error = signal<string | null>(null);

  // ── status + the not-bookable notice ────────────────────────────────
  const status = el('p', {
    'data-bn-loading': '',
    role: 'status',
    hidden: true,
  });
  const notice = el('output', {
    'data-bn-availability-notice': '',
    'data-testid': 'settings-availability-notice',
    role: 'status',
  });
  cleanups.push(
    effect(() => {
      const isLoading = resource.loading();
      const err = resource.error();
      if (isLoading && !resource.data()) {
        status.removeAttribute('hidden');
        status.textContent = 'Loading availability…';
        return;
      }
      if (err) {
        status.removeAttribute('hidden');
        status.setAttribute('data-bn-error', '');
        status.textContent = `Could not load availability: ${err.message}`;
        return;
      }
      status.setAttribute('hidden', '');
    }).dispose,
    effect(() => {
      if (bookable()) {
        notice.setAttribute('data-bn-tone', 'good');
        notice.textContent =
          'Bookable. Homeowners can be offered times inside these hours.';
      } else {
        notice.setAttribute('data-bn-tone', 'warn');
        notice.textContent =
          'Not bookable yet. Set a time zone and open at least one day, then save — until then nothing can be booked.';
      }
    }).dispose,
  );

  // ── time zone ─────────────────────────────────────────────────────────
  const zoneList = el('datalist', { id: 'settings-availability-timezones' });
  for (const zone of knownTimeZones()) {
    zoneList.append(el('option', { value: zone }));
  }
  const timezoneInput = el('input', {
    type: 'text',
    'data-bn-input': '',
    'data-testid': 'settings-availability-timezone',
    list: zoneList.id,
    autocomplete: 'off',
    placeholder: 'America/Chicago',
  }) as HTMLInputElement;
  cleanups.push(
    on(timezoneInput, 'input', () => {
      policy.set({ ...policy.peek(), timezone: timezoneInput.value.trim() });
    }),
  );

  // ── the seven rows ────────────────────────────────────────────────────
  const weekGrid = el('div', {
    'data-bn-availability-week': '',
    role: 'group',
    'aria-label': 'Weekly hours',
  });
  weekGrid.append(
    el('span', { 'data-bn-header': '' }, 'Day'),
    el('span', { 'data-bn-header': '' }, 'Open'),
    el('span', { 'data-bn-header': '' }, 'Opens'),
    el('span', { 'data-bn-header': '' }, 'Closes'),
  );
  const dayControls = new Map<
    number,
    {
      open: HTMLInputElement;
      opens: HTMLInputElement;
      closes: HTMLInputElement;
    }
  >();
  const patchDay = (weekday: number, patch: Partial<DayForm>): void => {
    week.set(
      week.peek().map((d) => (d.weekday === weekday ? { ...d, ...patch } : d)),
    );
  };
  for (const weekday of WEEKDAY_ORDER) {
    const name = WEEKDAY_NAMES[weekday] ?? '';
    const open = bindSwitch(
      el('input', {
        type: 'checkbox',
        'data-testid': `settings-availability-open-${weekday}`,
        'aria-label': `${name} open`,
      }) as HTMLInputElement,
    );
    const opens = el('input', {
      type: 'time',
      'data-bn-input': '',
      'data-testid': `settings-availability-opens-${weekday}`,
      'aria-label': `${name} opens at`,
    }) as HTMLInputElement;
    const closes = el('input', {
      type: 'time',
      'data-bn-input': '',
      'data-testid': `settings-availability-closes-${weekday}`,
      'aria-label': `${name} closes at`,
    }) as HTMLInputElement;
    dayControls.set(weekday, { open, opens, closes });
    cleanups.push(
      on(open, 'change', () => patchDay(weekday, { isOpen: open.checked })),
      on(opens, 'input', () => patchDay(weekday, { opensAt: opens.value })),
      on(closes, 'input', () => patchDay(weekday, { closesAt: closes.value })),
    );
    weekGrid.append(
      el('span', { 'data-bn-availability-dayname': '' }, name),
      el('label', { 'data-bn-toggle': '' }, open),
      opens,
      closes,
    );
  }
  // The rows are stable nodes; the signal writes into them by reference so a
  // keystroke never destroys the input it landed in.
  cleanups.push(
    effect(() => {
      for (const day of week()) {
        const controls = dayControls.get(day.weekday);
        if (!controls) continue;
        controls.open.checked = day.isOpen;
        controls.open.setAttribute(
          'aria-checked',
          day.isOpen ? 'true' : 'false',
        );
        controls.opens.value = day.opensAt;
        controls.closes.value = day.closesAt;
        controls.opens.disabled = !day.isOpen;
        controls.closes.disabled = !day.isOpen;
      }
    }).dispose,
  );

  // ── exceptions ────────────────────────────────────────────────────────
  const exceptionList = el('ul', {
    'data-bn-availability-exceptions': '',
    'data-testid': 'settings-availability-exceptions',
    'aria-label': 'Exceptions',
  });
  const exceptionEmpty = el(
    'p',
    {
      'data-bn-secondary': '',
      'data-testid': 'settings-availability-no-exceptions',
    },
    'No exceptions. Add a public holiday, a day off, or a day you are opening specially.',
  );
  cleanups.push(
    effect(() => {
      const list = exceptions();
      clear(exceptionList);
      exceptionEmpty.hidden = list.length > 0;
      for (const exception of list) {
        const remove = el(
          'button',
          {
            type: 'button',
            'data-bn-button': '',
            'data-bn-variant': 'ghost',
            'data-testid': `settings-availability-exception-remove-${exception.date}`,
            'aria-label': `Remove exception on ${exception.date}`,
          },
          'Remove',
        );
        remove.addEventListener('click', () => {
          exceptions.set(
            exceptions.peek().filter((e) => e.date !== exception.date),
          );
        });
        exceptionList.append(
          el(
            'li',
            {
              'data-bn-availability-exception': '',
              'data-bn-open': exception.isOpen ? 'true' : 'false',
            },
            el('strong', {}, exception.date),
            el(
              'span',
              {},
              exception.isOpen
                ? `Open ${exception.opensAt}–${exception.closesAt}`
                : 'Closed',
            ),
            el('span', { 'data-bn-secondary': '' }, exception.reason),
            remove,
          ),
        );
      }
    }).dispose,
  );

  const addDate = el('input', {
    type: 'date',
    'data-bn-input': '',
    'data-testid': 'settings-availability-exception-date',
  }) as HTMLInputElement;
  const addOpen = bindSwitch(
    el('input', {
      type: 'checkbox',
      'data-testid': 'settings-availability-exception-open',
    }) as HTMLInputElement,
  );
  const addOpens = el('input', {
    type: 'time',
    'data-bn-input': '',
    'data-testid': 'settings-availability-exception-opens',
  }) as HTMLInputElement;
  addOpens.value = DEFAULT_OPENS;
  addOpens.disabled = true;
  const addCloses = el('input', {
    type: 'time',
    'data-bn-input': '',
    'data-testid': 'settings-availability-exception-closes',
  }) as HTMLInputElement;
  addCloses.value = DEFAULT_CLOSES;
  addCloses.disabled = true;
  const addReason = el('input', {
    type: 'text',
    'data-bn-input': '',
    'data-testid': 'settings-availability-exception-reason',
    maxlength: '200',
    placeholder: 'Public holiday',
  }) as HTMLInputElement;
  const addError = el('output', {
    'data-bn-error': '',
    role: 'alert',
    hidden: true,
  });
  const addButton = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'secondary',
      'data-testid': 'settings-availability-exception-add',
    },
    'Add exception',
  );
  cleanups.push(
    on(addOpen, 'change', () => {
      addOpens.disabled = !addOpen.checked;
      addCloses.disabled = !addOpen.checked;
    }),
    on(addButton, 'click', () => {
      const date = addDate.value;
      if (!date) {
        addError.textContent = 'Pick a date first.';
        addError.hidden = false;
        return;
      }
      if (exceptions.peek().some((e) => e.date === date)) {
        addError.textContent = `${date} already has an exception — remove it to change it.`;
        addError.hidden = false;
        return;
      }
      if (addOpen.checked && addOpens.value >= addCloses.value) {
        addError.textContent = 'Closing time must be after opening time.';
        addError.hidden = false;
        return;
      }
      addError.hidden = true;
      exceptions.set(
        [
          ...exceptions.peek(),
          {
            date,
            isOpen: addOpen.checked,
            opensAt: addOpens.value || DEFAULT_OPENS,
            closesAt: addCloses.value || DEFAULT_CLOSES,
            reason: addReason.value.trim(),
          },
        ].sort((a, b) => a.date.localeCompare(b.date)),
      );
      addDate.value = '';
      addReason.value = '';
    }),
  );
  const addRow = el(
    'div',
    {
      'data-bn-availability-add': '',
      role: 'group',
      'aria-label': 'Add an exception',
    },
    formField('Date', addDate),
    el(
      'div',
      { 'data-bn-field': '' },
      el('label', { 'data-bn-toggle': '' }, addOpen, 'Open that day'),
    ),
    formField('Opens', addOpens),
    formField('Closes', addCloses),
    formField('Reason (optional)', addReason),
    addButton,
  );

  // ── the four numbers ──────────────────────────────────────────────────
  type NumberField = Exclude<keyof PolicyForm, 'timezone'>;
  const numberInputs = new Map<NumberField, HTMLInputElement>();
  const numberField = (
    label: string,
    key: NumberField,
    min: number,
    max: number,
  ): HTMLElement => {
    const input = el('input', {
      type: 'number',
      'data-bn-input': '',
      'data-testid': `settings-availability-${key}`,
      min: String(min),
      max: String(max),
      step: '1',
      inputmode: 'numeric',
    }) as HTMLInputElement;
    numberInputs.set(key, input);
    cleanups.push(
      on(input, 'input', () => {
        policy.set({ ...policy.peek(), [key]: Number(input.value) });
      }),
    );
    return formField(label, input);
  };
  const numbers = el(
    'div',
    { 'data-bn-field-grid': '' },
    numberField('Earliest booking (hours ahead)', 'bookingLeadHours', 0, 720),
    numberField('Latest booking (days ahead)', 'bookingHorizonDays', 1, 365),
    numberField(
      'Travel buffer between jobs (minutes)',
      'travelBufferMinutes',
      0,
      480,
    ),
    numberField('Jobs that can overlap', 'concurrentJobs', 1, 50),
  );

  // ── fill from the API ─────────────────────────────────────────────────
  const applyFromApi = (av: WorkspaceAvailability): void => {
    const byWeekday = new Map(av.week.map((d) => [d.weekday, d]));
    week.set(
      emptyWeek().map((blank) => {
        const day = byWeekday.get(blank.weekday);
        if (!day) return blank;
        return {
          weekday: blank.weekday,
          isOpen: day.isOpen,
          opensAt: day.opensAt ?? blank.opensAt,
          closesAt: day.closesAt ?? blank.closesAt,
        };
      }),
    );
    exceptions.set(
      av.exceptions.map((e) => ({
        date: e.date,
        isOpen: e.isOpen,
        opensAt: e.opensAt ?? DEFAULT_OPENS,
        closesAt: e.closesAt ?? DEFAULT_CLOSES,
        reason: e.reason ?? '',
      })),
    );
    const next: PolicyForm = {
      timezone: av.timezone ?? '',
      bookingLeadHours: av.bookingLeadHours,
      bookingHorizonDays: av.bookingHorizonDays,
      travelBufferMinutes: av.travelBufferMinutes,
      concurrentJobs: av.concurrentJobs,
    };
    policy.set(next);
    timezoneInput.value = next.timezone;
    for (const [key, input] of numberInputs) input.value = String(next[key]);
    bookable.set(av.bookable);
  };
  cleanups.push(
    effect(() => {
      const av = resource.data()?.data;
      if (av) applyFromApi(av);
    }).dispose,
  );

  // ── save ──────────────────────────────────────────────────────────────
  const saveBtn = el(
    'button',
    {
      type: 'submit',
      'data-bn-button': '',
      'data-bn-variant': 'primary',
      'data-testid': 'settings-availability-save',
    },
    'Save hours',
  );
  const savedNode = el(
    'span',
    { 'data-bn-saved': '', hidden: true, role: 'status' },
    'Saved',
  );
  const errorNode = el('output', {
    'data-bn-error': '',
    role: 'alert',
    hidden: true,
  });
  cleanups.push(
    effect(() => {
      saveBtn.disabled = saving();
      saveBtn.textContent = saving() ? 'Saving…' : 'Save hours';
    }).dispose,
    effect(() => {
      if (saved()) savedNode.removeAttribute('hidden');
      else savedNode.setAttribute('hidden', '');
    }).dispose,
    effect(() => {
      const m = error();
      if (m) {
        errorNode.textContent = m;
        errorNode.removeAttribute('hidden');
      } else {
        errorNode.setAttribute('hidden', '');
      }
    }).dispose,
  );

  const formEl = el(
    'form',
    { 'data-bn-availability-form': '' },
    notice,
    el(
      'fieldset',
      { 'data-bn-availability-section': '' },
      el('legend', {}, 'Time zone'),
      el(
        'p',
        { 'data-bn-secondary': '' },
        'The hours below are read in this zone. Nothing can be booked until it is set.',
      ),
      formField('Time zone', timezoneInput),
      zoneList,
    ),
    el(
      'fieldset',
      { 'data-bn-availability-section': '' },
      el('legend', {}, 'Weekly hours'),
      weekGrid,
    ),
    el(
      'fieldset',
      { 'data-bn-availability-section': '' },
      el('legend', {}, 'Exceptions'),
      el(
        'p',
        { 'data-bn-secondary': '' },
        'A dated exception wins over the weekly hours for that day — closed on a normal working day, or open on a normal day off.',
      ),
      exceptionEmpty,
      exceptionList,
      addError,
      addRow,
    ),
    el(
      'fieldset',
      { 'data-bn-availability-section': '' },
      el('legend', {}, 'Booking rules'),
      numbers,
    ),
    errorNode,
    el('footer', { 'data-bn-form-footer': '' }, savedNode, saveBtn),
  );

  cleanups.push(
    on(formEl, 'submit', async (event) => {
      event.preventDefault();
      saving.set(true);
      saved.set(false);
      error.set(null);
      try {
        const p = policy.peek();
        const { data } = await deps.availability.update({
          timezone: p.timezone ? p.timezone : null,
          bookingLeadHours: p.bookingLeadHours,
          bookingHorizonDays: p.bookingHorizonDays,
          travelBufferMinutes: p.travelBufferMinutes,
          concurrentJobs: p.concurrentJobs,
          week: week.peek().map((d) => ({
            weekday: d.weekday,
            isOpen: d.isOpen,
            opensAt: d.opensAt,
            closesAt: d.closesAt,
          })),
          exceptions: exceptions.peek().map((e) => ({
            date: e.date,
            isOpen: e.isOpen,
            ...(e.isOpen ? { opensAt: e.opensAt, closesAt: e.closesAt } : {}),
            ...(e.reason ? { reason: e.reason } : {}),
          })),
        });
        applyFromApi(data);
        saved.set(true);
        setTimeout(() => saved.set(false), 2500);
      } catch (err) {
        error.set(
          err instanceof Error ? err.message : 'Could not save availability.',
        );
      } finally {
        saving.set(false);
      }
    }),
  );

  const node = el(
    'div',
    {},
    el('h2', {}, 'Availability'),
    el(
      'p',
      { 'data-bn-secondary': '' },
      'When you take bookings. This is what a homeowner is offered a time from.',
    ),
    status,
    formEl,
  );

  return {
    node,
    dispose: () => {
      resource.dispose();
      for (const fn of cleanups) fn();
    },
  };
}

// ── Notifications panel ─────────────────────────────────────────────────
function renderNotificationsPanel(deps: PlatformDeps): {
  node: Node;
  dispose: Cleanup;
} {
  const cleanups: Cleanup[] = [];
  const resource = createResource<{ data: NotificationPreference[] }>(
    () => deps.notifications.list(),
    { auto: true },
  );

  const grid = el('div', { 'data-bn-notification-grid': '' });
  const status = el('p', {
    'data-bn-loading': '',
    role: 'status',
    hidden: true,
  });

  cleanups.push(
    effect(() => {
      const prefs = resource.data()?.data ?? [];
      const isLoading = resource.loading();
      const err = resource.error();
      if (isLoading && prefs.length === 0) {
        status.removeAttribute('hidden');
        status.textContent = 'Loading preferences…';
        return;
      }
      if (err) {
        status.removeAttribute('hidden');
        status.setAttribute('data-bn-error', '');
        status.textContent = `Could not load preferences: ${err.message}`;
        return;
      }
      status.setAttribute('hidden', '');

      clear(grid);
      grid.append(
        el('span', { 'data-bn-header': '' }, 'Event'),
        el('span', { 'data-bn-header': '' }, 'Email'),
        el('span', { 'data-bn-header': '' }, 'SMS'),
        el('span', { 'data-bn-header': '' }, 'Push'),
      );

      const lookup = new Map<string, boolean>();
      for (const p of prefs) {
        lookup.set(`${p.eventType}:${p.channel}`, p.enabled);
      }

      for (const event of NOTIFICATION_EVENTS) {
        grid.append(el('span', {}, event.label));
        for (const channel of NOTIFICATION_CHANNELS) {
          const enabled = lookup.get(`${event.type}:${channel}`) ?? false;
          const checkbox = bindSwitch(
            el('input', {
              type: 'checkbox',
              'data-testid': `settings-notif-${event.type}-${channel}`,
              'aria-label': `${event.label} via ${channel}`,
            }) as HTMLInputElement,
          );
          checkbox.checked = enabled;
          checkbox.setAttribute('aria-checked', enabled ? 'true' : 'false');
          checkbox.addEventListener('change', () => {
            void deps.notifications.update([
              { eventType: event.type, channel, enabled: checkbox.checked },
            ]);
          });
          grid.append(
            el(
              'label',
              { 'data-bn-toggle': '' },
              checkbox,
              el('span', { 'data-bn-sr-only': '' }, channel),
            ),
          );
        }
      }
    }).dispose,
  );

  const node = el(
    'div',
    {},
    el('h2', {}, 'Notifications'),
    el(
      'p',
      { 'data-bn-secondary': '' },
      'Choose which events ping you on which channels.',
    ),
    status,
    grid,
  );

  return {
    node,
    dispose: () => {
      resource.dispose();
      for (const fn of cleanups) fn();
    },
  };
}

// ── Team panel ───────────────────────────────────────────────────────────
function renderTeamPanel(deps: PlatformDeps): { node: Node; dispose: Cleanup } {
  const cleanups: Cleanup[] = [];
  const resource = createResource<{ data: WorkspaceUser[] }>(
    () => deps.workspace.listUsers(),
    { auto: true },
  );

  const showInvite = signal(false);
  const submitting = signal(false);
  const inviteError = signal<string | null>(null);
  // The invite link (GP-008). Nothing sends it: the API writes the
  // invitation and answers with the URL, and the owner passes it on by hand.
  // Inviting an email that exists but has never enrolled a passkey re-issues
  // the link, which is what the recovery screen tells a locked-out teammate
  // to ask for.
  const share = mountShareLink({ testId: 'settings-invite-share' });
  cleanups.push(share.dispose);

  const list = el('div', { 'data-bn-team-grid': '' });

  cleanups.push(
    effect(() => {
      const users = resource.data()?.data ?? [];
      clear(list);
      for (const user of users) {
        const initials =
          `${(user.firstName || '?')[0]}${(user.lastName || '?')[0]}`.toUpperCase();
        const roleSelect = el('select', {
          'data-bn-input': '',
          'data-testid': `settings-team-role-${user.id}`,
          'aria-label': `${user.firstName} ${user.lastName} role`,
        }) as HTMLSelectElement;
        for (const role of ROLES) {
          const opt = el('option', { value: role }, role);
          if (role === user.role) opt.setAttribute('selected', '');
          roleSelect.append(opt);
        }
        roleSelect.value = user.role;
        roleSelect.addEventListener('change', () => {
          void deps.workspace
            .updateUserRole(user.id, roleSelect.value as UserRole)
            .then(() => resource.reload());
        });

        const removeBtn = el(
          'button',
          {
            type: 'button',
            'data-bn-button': '',
            'data-bn-variant': 'ghost',
            'data-testid': `settings-team-remove-${user.id}`,
            'aria-label': `Remove ${user.firstName} ${user.lastName}`,
          },
          'Remove',
        );
        removeBtn.addEventListener('click', () => {
          void deps.workspace.removeUser(user.id).then(() => resource.reload());
        });

        list.append(
          el(
            'div',
            { 'data-bn-team-row': '' },
            el(
              'div',
              { 'data-bn-avatar': '', 'aria-hidden': 'true' },
              initials,
            ),
            el(
              'div',
              {},
              el('strong', {}, `${user.firstName} ${user.lastName}`),
              el('div', { 'data-bn-secondary': '' }, user.email),
            ),
            roleSelect,
            removeBtn,
          ),
        );
      }
    }).dispose,
  );

  // Invite form
  const inviteForm = signal({
    firstName: '',
    lastName: '',
    email: '',
    role: 'tech' as UserRole,
  });

  const inviteFields = el('div', { 'data-bn-field-grid': '' });
  const fnInput = el('input', {
    type: 'text',
    'data-bn-input': '',
    'data-testid': 'settings-invite-firstName',
  }) as HTMLInputElement;
  const lnInput = el('input', {
    type: 'text',
    'data-bn-input': '',
    'data-testid': 'settings-invite-lastName',
  }) as HTMLInputElement;
  const emailInput = el('input', {
    type: 'email',
    'data-bn-input': '',
    'data-testid': 'settings-invite-email',
  }) as HTMLInputElement;
  const roleInput = el('select', {
    'data-bn-input': '',
    'data-testid': 'settings-invite-role',
  }) as HTMLSelectElement;
  for (const role of ROLES) {
    roleInput.append(el('option', { value: role }, role));
  }
  roleInput.value = 'tech';
  for (const [input, key] of [
    [fnInput, 'firstName'],
    [lnInput, 'lastName'],
    [emailInput, 'email'],
  ] as const) {
    on(input, 'input', () => {
      inviteForm.set({
        ...inviteForm.peek(),
        [key]: input.value,
      });
    });
  }
  on(roleInput, 'change', () => {
    inviteForm.set({ ...inviteForm.peek(), role: roleInput.value as UserRole });
  });
  inviteFields.append(
    formField('First name', fnInput),
    formField('Last name', lnInput),
    formField('Email', emailInput),
    formField('Role', roleInput),
  );

  const inviteBtn = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'primary',
      'data-testid': 'settings-invite-toggle',
    },
    'Invite teammate',
  );
  cleanups.push(
    on(inviteBtn, 'click', () => showInvite.set(!showInvite.peek())),
  );

  const submitBtn = el(
    'button',
    {
      type: 'submit',
      'data-bn-button': '',
      'data-bn-variant': 'primary',
      'data-testid': 'settings-invite-submit',
    },
    'Create invite link',
  );

  const inviteErrorNode = el('output', {
    'data-bn-error': '',
    role: 'alert',
    hidden: true,
  });

  const invitePanel = el(
    'form',
    { 'data-bn-invite-form': '', hidden: true },
    inviteFields,
    inviteErrorNode,
    el('footer', { 'data-bn-form-footer': '' }, submitBtn),
  );
  cleanups.push(
    effect(() => {
      if (showInvite()) invitePanel.removeAttribute('hidden');
      else invitePanel.setAttribute('hidden', '');
    }).dispose,
    effect(() => {
      submitBtn.disabled = submitting();
      submitBtn.textContent = submitting() ? 'Creating…' : 'Create invite link';
    }).dispose,
    effect(() => {
      const message = inviteError();
      if (message) {
        inviteErrorNode.textContent = message;
        inviteErrorNode.removeAttribute('hidden');
      } else {
        inviteErrorNode.textContent = '';
        inviteErrorNode.setAttribute('hidden', '');
      }
    }).dispose,
    on(invitePanel, 'submit', async (event) => {
      event.preventDefault();
      const f = inviteForm.peek();
      fnInput.removeAttribute('aria-invalid');
      lnInput.removeAttribute('aria-invalid');
      emailInput.removeAttribute('aria-invalid');
      if (!f.firstName.trim() || !f.lastName.trim() || !f.email.trim()) {
        inviteError.set('First name, last name, and email are required.');
        const invalidInput = !f.firstName.trim()
          ? fnInput
          : !f.lastName.trim()
            ? lnInput
            : emailInput;
        invalidInput.setAttribute('aria-invalid', 'true');
        invalidInput.focus();
        return;
      }
      submitting.set(true);
      inviteError.set(null);
      try {
        const res = await deps.workspace.invite(f);
        if (res.share) share.show(res.share, 'Invite link ready to share');
        else share.hide();
        showInvite.set(false);
        fnInput.value = '';
        lnInput.value = '';
        emailInput.value = '';
        inviteForm.set({
          firstName: '',
          lastName: '',
          email: '',
          role: 'tech',
        });
        await resource.reload();
      } catch (err) {
        inviteError.set(
          err instanceof Error ? err.message : 'Could not create the invite.',
        );
      } finally {
        submitting.set(false);
      }
    }),
  );

  const node = el(
    'div',
    {},
    el(
      'header',
      { 'data-bn-section-header': '' },
      el('h2', {}, 'Team'),
      inviteBtn,
    ),
    invitePanel,
    share.element,
    list,
  );

  return {
    node,
    dispose: () => {
      resource.dispose();
      for (const fn of cleanups) fn();
    },
  };
}

// ── Billing panel ────────────────────────────────────────────────────────
//
// Reads the workspace's subscription (GET /api/billing/subscription, the
// shared `Subscription` model) and offers the Stripe Customer Portal. Three
// things this panel is careful about, because each was a reported defect
// (GP-048):
//
//   - Renews comes from `currentPeriodEnd`, the field the API actually
//     emits — not a camelCase name guessed at a snake_case row.
//   - The portal click has an error path. The API refuses with 503
//     BILLING_UNAVAILABLE (Stripe not configured) or 400 NO_CUSTOMER (no
//     Stripe customer on the workspace); either message is shown as-is,
//     and the button is busy while the request is in flight.
//   - No subscription row means billing is not set up for this workspace.
//     The panel says exactly that. Starting a subscription is staff-assisted
//     today (the same way custom domains are — see the Branding panel), so
//     there is no subscribe form and no portal button to click into a 400.
function renderBillingPanel(deps: PlatformDeps): {
  node: Node;
  dispose: Cleanup;
} {
  const cleanups: Cleanup[] = [];
  const resource = createResource<{ data: Subscription | null }>(
    () => deps.billing.status(),
    { auto: true },
  );
  const portalBusy = signal(false);
  const portalError = signal<string | null>(null);

  const summary = el('dl', {
    'data-bn-billing-summary': '',
    'data-testid': 'settings-billing-summary',
    hidden: true,
  });
  const status = el('p', {
    'data-bn-loading': '',
    role: 'status',
    hidden: true,
  });
  const notSetUp = el(
    'p',
    {
      'data-bn-secondary': '',
      'data-testid': 'settings-billing-none',
      hidden: true,
    },
    'Billing is not set up for this workspace yet. Contact Greenput to start a subscription — plans are set up with our help today, not from this page.',
  );
  const portalBtn = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'secondary',
      'data-testid': 'settings-billing-portal',
      hidden: true,
    },
    'Open Stripe portal',
  );
  const portalNote = el('p', {
    'data-bn-error': '',
    role: 'alert',
    'data-testid': 'settings-billing-portal-error',
    hidden: true,
  });

  cleanups.push(
    on(portalBtn, 'click', () => {
      if (portalBusy()) return;
      void (async () => {
        portalBusy.set(true);
        portalError.set(null);
        try {
          const res = await deps.billing.portal();
          const url = res.data?.url;
          if (!url) {
            portalError.set(
              'Stripe did not return a portal link. Try again in a moment.',
            );
            return;
          }
          window.open(url, '_blank', 'noopener');
        } catch (err) {
          // The API's own sentence is the explanation ("Billing is not
          // configured", "No billing account found. Subscribe to a plan
          // first."). Rewording it here would only let the two drift.
          portalError.set(
            err instanceof Error && err.message
              ? err.message
              : 'Could not open the Stripe portal.',
          );
        } finally {
          portalBusy.set(false);
        }
      })();
    }),
  );

  cleanups.push(
    effect(() => {
      const busy = portalBusy();
      portalBtn.disabled = busy;
      portalBtn.textContent = busy ? 'Opening portal…' : 'Open Stripe portal';
      if (busy) portalBtn.setAttribute('data-bn-busy', '');
      else portalBtn.removeAttribute('data-bn-busy');
    }).dispose,
  );

  cleanups.push(
    effect(() => {
      const message = portalError();
      if (message) {
        portalNote.textContent = message;
        portalNote.removeAttribute('hidden');
      } else {
        portalNote.textContent = '';
        portalNote.setAttribute('hidden', '');
      }
    }).dispose,
  );

  cleanups.push(
    effect(() => {
      const billing = resource.data()?.data ?? null;
      const isLoading = resource.loading();
      const err = resource.error();
      if (isLoading && !billing) {
        status.removeAttribute('hidden');
        status.removeAttribute('data-bn-error');
        status.textContent = 'Loading subscription…';
        summary.setAttribute('hidden', '');
        notSetUp.setAttribute('hidden', '');
        portalBtn.setAttribute('hidden', '');
        return;
      }
      if (err) {
        status.removeAttribute('hidden');
        status.setAttribute('data-bn-error', '');
        status.textContent = `Could not load subscription: ${err.message}`;
        summary.setAttribute('hidden', '');
        notSetUp.setAttribute('hidden', '');
        portalBtn.setAttribute('hidden', '');
        return;
      }
      status.setAttribute('hidden', '');
      if (!billing) {
        // The absence of a row is the true state. Do not synthesise a plan
        // from `workspaces.stripe_customer_id`, and do not offer a portal
        // button whose only possible answer is 400 NO_CUSTOMER.
        clear(summary);
        summary.setAttribute('hidden', '');
        portalBtn.setAttribute('hidden', '');
        notSetUp.removeAttribute('hidden');
        return;
      }
      notSetUp.setAttribute('hidden', '');
      clear(summary);
      summary.append(
        el('dt', {}, 'Plan'),
        el('dd', { 'data-testid': 'settings-billing-plan' }, billing.plan),
        el('dt', {}, 'Status'),
        el(
          'dd',
          { 'data-testid': 'settings-billing-status' },
          statusBadge(billing.status, billing.status),
        ),
        el('dt', {}, 'Renews'),
        el(
          'dd',
          { 'data-testid': 'settings-billing-renews' },
          billing.cancelAtPeriodEnd
            ? `Ends ${new Date(billing.currentPeriodEnd).toLocaleDateString('en-US')}`
            : new Date(billing.currentPeriodEnd).toLocaleDateString('en-US'),
        ),
      );
      summary.removeAttribute('hidden');
      portalBtn.removeAttribute('hidden');
    }).dispose,
  );

  const meterResource = createResource<{ data: LeadFeeMeter }>(
    () => deps.billing.meter(),
    { auto: true },
  );
  const connectResource = createResource<{ data: ConnectStatus }>(
    () => deps.billing.connectStatus(),
    { auto: true },
  );
  const leadBody = el('div', { 'data-testid': 'settings-lead-fees-body' });
  const cardBusy = signal(false);
  const cardError = signal<string | null>(null);
  const cardBtn = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-testid': 'settings-lead-fees-card',
    },
    'Add a card for lead fees',
  );
  const cardNote = el('p', {
    'data-bn-error': '',
    role: 'alert',
    'data-testid': 'settings-lead-fees-card-error',
    hidden: true,
  });
  const collectBusy = signal(false);
  const collectError = signal<string | null>(null);
  const collectBtn = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-testid': 'settings-lead-fees-collect',
      hidden: true,
    },
    'Charge saved card',
  );
  const collectNote = el('p', {
    'data-bn-error': '',
    role: 'alert',
    'data-testid': 'settings-lead-fees-collect-error',
    hidden: true,
  });
  const connectBusy = signal(false);
  const connectError = signal<string | null>(null);
  const connectBtn = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-testid': 'settings-connect-onboard',
    },
    'Set up Stripe to get paid',
  );
  const connectNote = el('p', {
    'data-bn-error': '',
    role: 'alert',
    'data-testid': 'settings-connect-error',
    hidden: true,
  });
  const connectBody = el('div', { 'data-testid': 'settings-connect-body' });

  cleanups.push(
    on(cardBtn, 'click', () => {
      if (cardBusy()) return;
      void (async () => {
        cardBusy.set(true);
        cardError.set(null);
        try {
          const back = `${window.location.origin}/settings?tab=billing`;
          const res = await deps.billing.paymentMethod(back);
          const url = res.data?.url;
          if (!url) {
            cardError.set(
              'Stripe did not return a link. Try again in a moment.',
            );
            return;
          }
          window.open(url, '_blank', 'noopener');
        } catch (err) {
          cardError.set(
            err instanceof Error && err.message
              ? err.message
              : 'Could not open Stripe to add a card.',
          );
        } finally {
          cardBusy.set(false);
        }
      })();
    }),
  );
  cleanups.push(
    on(collectBtn, 'click', () => {
      if (collectBusy()) return;
      void (async () => {
        collectBusy.set(true);
        collectError.set(null);
        try {
          await deps.billing.collectLeadFees();
          meterResource.reload();
        } catch (err) {
          collectError.set(
            err instanceof Error && err.message
              ? err.message
              : 'Could not charge the saved card.',
          );
        } finally {
          collectBusy.set(false);
        }
      })();
    }),
  );
  cleanups.push(
    effect(() => {
      const pending =
        (meterResource.data()?.data.summary.pendingCount ?? 0) > 0;
      collectBtn.disabled = collectBusy() || !pending;
      collectBtn.textContent = collectBusy()
        ? 'Charging…'
        : 'Charge saved card';
      if (pending) collectBtn.removeAttribute('hidden');
      else collectBtn.setAttribute('hidden', '');
      const message = collectError();
      if (message) {
        collectNote.textContent = message;
        collectNote.removeAttribute('hidden');
      } else {
        collectNote.textContent = '';
        collectNote.setAttribute('hidden', '');
      }
    }).dispose,
  );
  cleanups.push(
    on(connectBtn, 'click', () => {
      if (connectBusy()) return;
      void (async () => {
        connectBusy.set(true);
        connectError.set(null);
        try {
          const back = `${window.location.origin}/settings?tab=billing`;
          const complete = connectResource.data()?.data.status === 'complete';
          const res = complete
            ? await deps.billing.connectLogin()
            : await deps.billing.connectOnboard(back);
          const url = res.data?.url;
          if (!url) {
            connectError.set(
              'Stripe did not return a link. Try again in a moment.',
            );
            return;
          }
          window.open(url, '_blank', 'noopener');
        } catch (err) {
          connectError.set(
            err instanceof Error && err.message
              ? err.message
              : 'Could not start Stripe setup.',
          );
        } finally {
          connectBusy.set(false);
        }
      })();
    }),
  );
  cleanups.push(
    effect(() => {
      cardBtn.disabled = cardBusy();
      cardBtn.textContent = cardBusy()
        ? 'Opening Stripe…'
        : 'Add a card for lead fees';
      const message = cardError();
      if (message) {
        cardNote.textContent = message;
        cardNote.removeAttribute('hidden');
      } else {
        cardNote.textContent = '';
        cardNote.setAttribute('hidden', '');
      }
    }).dispose,
  );
  cleanups.push(
    effect(() => {
      const data = meterResource.data()?.data;
      clear(leadBody);
      if (meterResource.loading() && !data) {
        leadBody.append(el('p', { role: 'status' }, 'Loading lead fees…'));
        return;
      }
      const err = meterResource.error();
      if (err) {
        leadBody.append(
          el(
            'p',
            { 'data-bn-error': '', role: 'alert' },
            `Could not load lead fees: ${err.message}`,
          ),
        );
        return;
      }
      if (!data) return;
      const override = data.leadFeeOverrideUsd;
      if (data.receive?.message) {
        leadBody.append(
          el(
            'p',
            {
              role: 'status',
              'data-testid': 'settings-lead-fees-receive',
            },
            data.receive.message,
          ),
        );
      }
      leadBody.append(
        el(
          'p',
          { 'data-bn-secondary': '', 'data-testid': 'settings-lead-fees-rate' },
          override !== null
            ? `This workspace is billed ${dollars(override)} per booked lead. That rate is grandfathered and does not follow the standard rate card. A card on file is required, and each lead fee is charged when a job is booked.`
            : 'A card on file is required before this workspace can accept or auto-book a lead. Each lead fee is charged when a job is booked — accepting a lead charges nothing.',
        ),
        el(
          'p',
          { 'data-testid': 'settings-lead-fees-pending' },
          `${data.summary.pendingCount} pending (${dollars(data.summary.pendingUsd)}), ${data.summary.invoicedCount} invoiced (${dollars(data.summary.invoicedUsd)}).`,
        ),
      );
      const tableHost = el('div', { 'data-bn-table-wrap': '' });
      mountTable(tableHost, {
        caption: 'Lead charges',
        emptyMessage: 'No lead charges yet.',
        columns: [
          {
            key: 'service',
            label: 'Service',
            value: (row: LeadFeeCharge) => row.serviceType,
            href: (row: LeadFeeCharge) => `/leads/${row.leadId}`,
          },
          {
            key: 'amount',
            label: 'Amount',
            align: 'end',
            value: (row: LeadFeeCharge) => dollars(row.priceUsd),
          },
          {
            key: 'status',
            label: 'Status',
            value: (row: LeadFeeCharge) => leadChargeLabel(row),
          },
        ],
        rows: data.charges,
      });
      leadBody.append(tableHost);
    }).dispose,
  );
  cleanups.push(
    effect(() => {
      const state = connectResource.data()?.data ?? null;
      const busy = connectBusy();
      connectBtn.disabled = busy || connectResource.loading();
      clear(connectBody);
      if (connectResource.loading() && !state) {
        connectBody.append(
          el('p', { role: 'status' }, 'Loading card payments…'),
        );
        return;
      }
      const err = connectResource.error();
      if (err) {
        connectBody.append(
          el(
            'p',
            { 'data-bn-error': '', role: 'alert' },
            `Could not load card payments: ${err.message}`,
          ),
        );
        return;
      }
      if (!state) return;
      const copy =
        state.status === 'complete'
          ? 'Card payments are connected. Open Stripe to see payouts.'
          : state.status === 'pending'
            ? 'Stripe still needs a few details before you can take cards.'
            : 'Homeowner card payments use Stripe. Set up Stripe to get paid for jobs.';
      connectBody.append(
        el('p', { 'data-testid': 'settings-connect-status' }, copy),
      );
      connectBtn.textContent = busy
        ? 'Opening Stripe…'
        : state.status === 'complete'
          ? 'Open Stripe Express'
          : state.status === 'pending'
            ? 'Continue Stripe setup'
            : 'Set up Stripe to get paid';
      const message = connectError();
      if (message) {
        connectNote.textContent = message;
        connectNote.removeAttribute('hidden');
      } else {
        connectNote.textContent = '';
        connectNote.setAttribute('hidden', '');
      }
    }).dispose,
  );

  const usageResource = createResource<{ data: UsageBalance }>(
    () => deps.billing.usage(),
    { auto: true },
  );
  const usageBody = el('div', { 'data-testid': 'settings-usage-body' });
  const usageError = signal<string | null>(null);
  const usageBusy = signal(false);
  let usageFilled = false;
  const topupInput = el('input', {
    type: 'number',
    min: '0.5',
    max: '1000',
    step: '0.01',
    inputmode: 'decimal',
    'data-testid': 'settings-usage-topup',
  }) as HTMLInputElement;
  const thresholdInput = el('input', {
    type: 'number',
    min: '0',
    step: '0.01',
    inputmode: 'decimal',
    'data-testid': 'settings-usage-threshold',
  }) as HTMLInputElement;
  const usageSave = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-testid': 'settings-usage-save',
    },
    'Save SMS top-up',
  );
  const usageNote = el('p', {
    'data-bn-error': '',
    role: 'alert',
    'data-testid': 'settings-usage-error',
    hidden: true,
  });
  cleanups.push(
    on(usageSave, 'click', () => {
      if (usageBusy()) return;
      void (async () => {
        usageBusy.set(true);
        usageError.set(null);
        try {
          const topupCents = Math.round(Number(topupInput.value) * 100);
          const thresholdCents = Math.round(Number(thresholdInput.value) * 100);
          await deps.billing.updateUsage({ topupCents, thresholdCents });
          usageResource.reload();
        } catch (err) {
          usageError.set(
            err instanceof Error && err.message
              ? err.message
              : 'Could not save the SMS top-up.',
          );
        } finally {
          usageBusy.set(false);
        }
      })();
    }),
  );
  cleanups.push(
    effect(() => {
      const busy = usageBusy();
      usageSave.disabled = busy;
      usageSave.textContent = busy ? 'Saving…' : 'Save SMS top-up';
      const message = usageError();
      if (message) {
        usageNote.textContent = message;
        usageNote.removeAttribute('hidden');
      } else {
        usageNote.textContent = '';
        usageNote.setAttribute('hidden', '');
      }
    }).dispose,
  );
  cleanups.push(
    effect(() => {
      const data = usageResource.data()?.data;
      clear(usageBody);
      if (usageResource.loading() && !data) {
        usageBody.append(el('p', { role: 'status' }, 'Loading SMS balance…'));
        return;
      }
      const err = usageResource.error();
      if (err) {
        usageBody.append(
          el(
            'p',
            { 'data-bn-error': '', role: 'alert' },
            `Could not load SMS balance: ${err.message}`,
          ),
        );
        return;
      }
      if (!data) return;
      if (!usageFilled) {
        topupInput.value = (data.topupCents / 100).toFixed(2);
        thresholdInput.value = (data.thresholdCents / 100).toFixed(2);
        usageFilled = true;
      }
      usageBody.append(
        el(
          'p',
          { 'data-testid': 'settings-usage-balance' },
          `Balance ${microUsd(data.balanceMicroUsd)}. A booking text or a chat fallback reserves Twilio's US list price (${microUsd(TWILIO_US_SMS_SEGMENT_MICRO_USD)} per segment), then adjusts to the price Twilio reports. When the balance falls below the threshold, the card on file is charged the top-up amount. Sign-in codes are not charged here.`,
        ),
        formField('Top-up amount (USD)', topupInput, 'settings-usage-topup'),
        formField(
          'Top up when the balance falls below (USD)',
          thresholdInput,
          'settings-usage-threshold',
        ),
      );
      const tableHost = el('div', { 'data-bn-table-wrap': '' });
      mountTable(tableHost, {
        caption: 'SMS usage',
        emptyMessage: 'No SMS usage yet.',
        columns: [
          {
            key: 'when',
            label: 'When',
            value: (row: UsageLedgerEntry) =>
              new Date(row.createdAt).toLocaleString('en-US'),
          },
          {
            key: 'what',
            label: 'What',
            value: (row: UsageLedgerEntry) => usageKindLabel(row.kind),
          },
          {
            key: 'amount',
            label: 'Amount',
            align: 'end',
            value: (row: UsageLedgerEntry) => microUsd(row.amountMicroUsd),
          },
        ],
        rows: data.entries,
      });
      usageBody.append(tableHost);
    }).dispose,
  );

  const node = el(
    'div',
    {},
    el('h2', {}, 'Billing'),
    el(
      'p',
      { 'data-bn-secondary': '' },
      'Subscription managed via Stripe. Open the portal to update payment details or download invoices.',
    ),
    status,
    notSetUp,
    summary,
    portalBtn,
    portalNote,
    el(
      'section',
      {
        'aria-labelledby': 'settings-lead-fees-heading',
        'data-testid': 'settings-lead-fees',
      },
      el('h3', { id: 'settings-lead-fees-heading' }, 'Lead fees'),
      leadBody,
      collectBtn,
      collectNote,
      cardBtn,
      cardNote,
    ),
    el(
      'section',
      {
        'aria-labelledby': 'settings-usage-heading',
        'data-testid': 'settings-usage',
      },
      el('h3', { id: 'settings-usage-heading' }, 'SMS usage'),
      usageBody,
      usageSave,
      usageNote,
    ),
    el(
      'section',
      {
        'aria-labelledby': 'settings-connect-heading',
        'data-testid': 'settings-connect',
      },
      el('h3', { id: 'settings-connect-heading' }, 'Card payments'),
      connectBody,
      connectBtn,
      connectNote,
    ),
  );

  return {
    node,
    dispose: () => {
      resource.dispose();
      meterResource.dispose();
      usageResource.dispose();
      connectResource.dispose();
      for (const fn of cleanups) fn();
    },
  };
}

function dollars(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

/** micro-USD (1 USD = 1_000_000) as dollars, keeping a sub-cent SMS price. */
function microUsd(micro: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(micro / 1_000_000);
}

function usageKindLabel(kind: string): string {
  if (kind === 'topup') return 'Top-up';
  if (kind === 'sms_estimate') return 'SMS';
  if (kind === 'sms_reconcile') return 'Price adjustment';
  if (kind === 'sms_reversal') return 'SMS reversed';
  return kind;
}

function leadChargeLabel(charge: LeadFeeCharge): string {
  if (charge.status === 'waived') return 'Waived';
  if (charge.status === 'refunded') return 'Refunded';
  if (charge.paymentStatus === 'no_payment_method') return 'Needs a card';
  if (charge.paymentStatus === 'failed') return 'Payment failed';
  if (charge.paymentStatus === 'processing') return 'Processing';
  if (charge.paymentStatus === 'unconfigured') return 'Billing not configured';
  if (charge.paymentStatus === 'below_minimum') return 'Below card minimum';
  if (charge.paymentStatus === 'paid' || charge.status === 'invoiced')
    return 'Paid';
  if (charge.status === 'pending') return 'Pending';
  return 'Invoiced';
}

// ── Webhooks panel ───────────────────────────────────────────────────────
function renderWebhooksPanel(deps: PlatformDeps): {
  node: Node;
  dispose: Cleanup;
} {
  const cleanups: Cleanup[] = [];
  const resource = createResource<{ data: Webhook[] }>(
    () => deps.webhooks.list(),
    { auto: true },
  );

  const showCreate = signal(false);
  const formUrl = signal('');
  const formEvents = signal('lead.created,job.completed');
  const createError = signal<string | null>(null);

  const tableWrap = el('div', { 'data-bn-table-wrap': '' });
  cleanups.push(
    onRowAction(tableWrap, (action, id) => {
      if (action === 'delete') {
        void deps.webhooks.delete(id).then(() => resource.reload());
      }
    }),
    delegate(
      tableWrap,
      'change',
      'input[data-action="toggle"]',
      (_event, input) => {
        void deps.webhooks
          .toggle(
            input.getAttribute('data-id') ?? '',
            (input as HTMLInputElement).checked,
          )
          .then(() => resource.reload());
      },
    ),
  );
  const empty = el(
    'p',
    { 'data-bn-empty': '', hidden: true },
    'No webhooks configured.',
  );
  const status = el(
    'p',
    { 'data-bn-loading': '', role: 'status', hidden: true },
    'Loading webhooks…',
  );

  cleanups.push(
    effect(() => {
      const list = resource.data()?.data ?? [];
      const isLoading = resource.loading();
      toggleAttr(status, isLoading && list.length === 0, 'hidden');
      toggleAttr(empty, !isLoading && list.length === 0, 'hidden');

      mountTable(tableWrap, { columns: WEBHOOK_COLUMNS, rows: list });
    }).dispose,
  );

  const urlInput = el('input', {
    type: 'url',
    'data-bn-input': '',
    'data-testid': 'settings-webhook-url',
    placeholder: 'https://example.com/webhook',
  }) as HTMLInputElement;
  on(urlInput, 'input', () => formUrl.set(urlInput.value));
  const eventsInput = el('input', {
    type: 'text',
    'data-bn-input': '',
    'data-testid': 'settings-webhook-events',
    placeholder: 'lead.created,job.completed',
  }) as HTMLInputElement;
  eventsInput.value = 'lead.created,job.completed';
  on(eventsInput, 'input', () => formEvents.set(eventsInput.value));

  const submitBtn = el(
    'button',
    {
      type: 'submit',
      'data-bn-button': '',
      'data-bn-variant': 'primary',
      'data-testid': 'settings-webhook-submit',
    },
    'Add webhook',
  );

  const createErrorNode = el('output', {
    'data-bn-error': '',
    role: 'alert',
    hidden: true,
  });

  const createForm = el(
    'form',
    { 'data-bn-create-form': '', hidden: true },
    el(
      'div',
      { 'data-bn-field-grid': '' },
      formField('URL', urlInput),
      formField('Events (comma-separated)', eventsInput),
    ),
    createErrorNode,
    el('footer', { 'data-bn-form-footer': '' }, submitBtn),
  );
  cleanups.push(
    effect(() => {
      if (showCreate()) createForm.removeAttribute('hidden');
      else createForm.setAttribute('hidden', '');
    }).dispose,
    effect(() => {
      const message = createError();
      if (message) {
        createErrorNode.textContent = message;
        createErrorNode.removeAttribute('hidden');
      } else {
        createErrorNode.textContent = '';
        createErrorNode.setAttribute('hidden', '');
      }
    }).dispose,
    on(createForm, 'submit', async (event) => {
      event.preventDefault();
      urlInput.removeAttribute('aria-invalid');
      if (!formUrl.peek().trim()) {
        createError.set('URL is required.');
        urlInput.setAttribute('aria-invalid', 'true');
        urlInput.focus();
        return;
      }
      const events = formEvents
        .peek()
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean);
      try {
        await deps.webhooks.create({ url: formUrl.peek(), events });
        createError.set(null);
        showCreate.set(false);
        urlInput.value = '';
        formUrl.set('');
        await resource.reload();
      } catch (err) {
        createError.set(
          err instanceof Error ? err.message : 'Could not create webhook.',
        );
      }
    }),
  );

  const newBtn = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'primary',
      'data-testid': 'settings-webhook-toggle',
    },
    'New webhook',
  );
  cleanups.push(on(newBtn, 'click', () => showCreate.set(!showCreate.peek())));

  const node = el(
    'div',
    {},
    el(
      'header',
      { 'data-bn-section-header': '' },
      el('h2', {}, 'Webhooks'),
      newBtn,
    ),
    createForm,
    status,
    empty,
    tableWrap,
  );

  return {
    node,
    dispose: () => {
      resource.dispose();
      for (const fn of cleanups) fn();
    },
  };
}

const WEBHOOK_COLUMNS: readonly TableColumn<Webhook>[] = [
  {
    key: 'url',
    label: 'URL',
    value: (webhook) => webhook.url,
    cell: (webhook, td) => fill(td, el('code', {}, webhook.url)),
  },
  {
    key: 'events',
    label: 'Events',
    value: (webhook) => webhook.events.join(', '),
  },
  {
    key: 'status',
    label: 'Status',
    value: (webhook) => (webhook.active ? 'On' : 'Off'),
    cell: (webhook, td) => {
      const input = bindSwitch(
        el('input', {
          type: 'checkbox',
          'data-action': 'toggle',
          'data-id': webhook.id,
          'data-testid': `settings-webhook-toggle-${webhook.id}`,
          'aria-label': 'Enabled',
        }) as HTMLInputElement,
      );
      input.checked = webhook.active;
      input.setAttribute('aria-checked', webhook.active ? 'true' : 'false');
      fill(
        td,
        el(
          'label',
          { 'data-bn-toggle': '' },
          input,
          el('span', {}, webhook.active ? 'On' : 'Off'),
        ),
      );
    },
  },
  {
    key: 'actions',
    label: '',
    value: () => '',
    cell: (webhook, td) =>
      fill(
        td,
        actionButton({
          action: 'delete',
          id: webhook.id,
          label: 'Delete',
          testId: `settings-webhook-delete-${webhook.id}`,
          variant: 'ghost',
        }),
      ),
  },
];

// ── Branding panel ───────────────────────────────────────────────────────
function renderBrandingPanel(deps: PlatformDeps): {
  node: Node;
  dispose: Cleanup;
} {
  const cleanups: Cleanup[] = [];
  const resource = createResource<{ data: Branding }>(
    () => deps.branding.get(),
    { auto: true },
  );

  type Form = {
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    fontFamily: string;
    emailFooter: string;
  };
  const form = signal<Form>({
    primaryColor: '#3d8b5e',
    secondaryColor: '#1f2937',
    accentColor: '#2d6e9c',
    fontFamily: 'system-ui',
    emailFooter: '',
  });
  const saving = signal(false);
  const saved = signal(false);

  const colorInputs = new Map<keyof Form, HTMLInputElement>();
  const swatches = el('div', { 'data-bn-color-row': '' });
  for (const key of [
    'primaryColor',
    'secondaryColor',
    'accentColor',
  ] as const) {
    const input = el('input', {
      type: 'color',
      'data-testid': `settings-branding-${key}`,
    }) as HTMLInputElement;
    input.value = form.peek()[key];
    on(input, 'input', () => {
      form.set({ ...form.peek(), [key]: input.value });
    });
    colorInputs.set(key, input);
    input.id = `settings-branding-${key}`;
    swatches.append(
      el(
        'div',
        { 'data-bn-color-swatch': '' },
        el('label', { for: input.id }, key.replace('Color', '')),
        input,
      ),
    );
  }
  const fontInput = el('input', {
    type: 'text',
    'data-bn-input': '',
    'data-testid': 'settings-branding-fontFamily',
  }) as HTMLInputElement;
  fontInput.value = form.peek().fontFamily;
  on(fontInput, 'input', () => {
    form.set({ ...form.peek(), fontFamily: fontInput.value });
  });

  const footerInput = el('textarea', {
    'data-bn-input': '',
    'data-testid': 'settings-branding-emailFooter',
    placeholder: 'Custom email footer text…',
  }) as HTMLTextAreaElement;
  on(footerInput, 'input', () => {
    form.set({ ...form.peek(), emailFooter: footerInput.value });
  });

  cleanups.push(
    effect(() => {
      const b = resource.data()?.data;
      if (!b) return;
      const next: Form = {
        primaryColor: b.primaryColor || '#3d8b5e',
        secondaryColor: b.secondaryColor || '#1f2937',
        accentColor: b.accentColor || '#2d6e9c',
        fontFamily: b.fontFamily || 'system-ui',
        emailFooter: b.emailFooter || '',
      };
      form.set(next);
      for (const [key, input] of colorInputs) input.value = next[key];
      fontInput.value = next.fontFamily;
      footerInput.value = next.emailFooter;
    }).dispose,
  );

  const submitBtn = el(
    'button',
    {
      type: 'submit',
      'data-bn-button': '',
      'data-bn-variant': 'primary',
      'data-testid': 'settings-branding-save',
    },
    'Save branding',
  );
  cleanups.push(
    effect(() => {
      submitBtn.disabled = saving();
      submitBtn.textContent = saving() ? 'Saving…' : 'Save branding';
    }).dispose,
  );
  const savedNode = el(
    'span',
    { 'data-bn-saved': '', hidden: true, role: 'status' },
    'Saved',
  );
  cleanups.push(
    effect(() => {
      if (saved()) savedNode.removeAttribute('hidden');
      else savedNode.setAttribute('hidden', '');
    }).dispose,
  );

  const formEl = el(
    'form',
    {},
    swatches,
    formField('Font family', fontInput),
    formField('Email footer', footerInput),
    el('footer', { 'data-bn-form-footer': '' }, savedNode, submitBtn),
  );
  cleanups.push(
    on(formEl, 'submit', async (event) => {
      event.preventDefault();
      saving.set(true);
      saved.set(false);
      try {
        await deps.branding.update(form.peek());
        saved.set(true);
        setTimeout(() => saved.set(false), 2500);
      } finally {
        saving.set(false);
      }
    }),
  );

  // ── Custom domain (read-only status view) ──────────────────────────────
  // Every workspace gets <slug>.greenput.com by default. A contractor can
  // CNAME a domain they own onto that site instead (Cloudflare for SaaS,
  // one-time setup fee) — see duganlabs-survey/greenput-custom-domains.md.
  // This is deliberately status-only: requesting a new domain today is a
  // staff-assisted step (POST /api/custom-domain), not a self-serve form,
  // so there is no "enter a domain" input here — just what's configured,
  // the CNAME target, and a way to re-check Cloudflare's verification.
  const domainResource = createResource<{ data: CustomDomain }>(
    () => deps.customDomain.get(),
    { auto: true },
  );
  const rechecking = signal(false);
  const recheckNote = signal<string | null>(null);

  const domainStatusEl = el('span', {
    'data-testid': 'settings-custom-domain-status',
  });
  const domainHostnameEl = el('code', {
    'data-testid': 'settings-custom-domain-hostname',
  });
  const domainCnameEl = el('code', {
    'data-testid': 'settings-custom-domain-cname',
  });
  const domainNoteEl = el('p', { 'data-bn-secondary': '', hidden: true });
  const domainEmptyEl = el(
    'p',
    { 'data-bn-secondary': '', 'data-testid': 'settings-custom-domain-empty' },
    'No custom domain configured. Contact Greenput to set one up — it carries a one-time setup fee.',
  );
  const domainDetail = el(
    'div',
    { 'data-bn-field': '', hidden: true },
    el('div', {}, el('label', {}, 'Status'), domainStatusEl),
    el('div', {}, el('label', {}, 'Domain'), domainHostnameEl),
    el(
      'div',
      {},
      el('label', {}, 'CNAME target'),
      domainCnameEl,
      el(
        'p',
        { 'data-bn-secondary': '' },
        'Point this hostname at the target above with a CNAME record at your DNS provider. An apex/root domain (no "www") needs CNAME flattening — ask your DNS provider if they support it.',
      ),
    ),
  );
  const recheckBtn = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'secondary',
      'data-testid': 'settings-custom-domain-recheck',
      hidden: true,
    },
    'Check status',
  ) as HTMLButtonElement;

  cleanups.push(
    effect(() => {
      const domain = domainResource.data()?.data;
      const hasDomain = !!domain && domain.status !== 'none';
      domainEmptyEl.toggleAttribute('hidden', hasDomain);
      domainDetail.toggleAttribute('hidden', !hasDomain);
      recheckBtn.toggleAttribute(
        'hidden',
        !hasDomain || domain?.status === 'active',
      );
      if (!domain) return;
      domainStatusEl.textContent = domain.status;
      domainHostnameEl.textContent = domain.hostname ?? '—';
      domainCnameEl.textContent = domain.cnameTarget;
    }).dispose,
  );
  cleanups.push(
    effect(() => {
      recheckBtn.disabled = rechecking();
      recheckBtn.textContent = rechecking() ? 'Checking…' : 'Check status';
    }).dispose,
  );
  cleanups.push(
    effect(() => {
      const note = recheckNote();
      domainNoteEl.textContent = note ?? '';
      domainNoteEl.toggleAttribute('hidden', !note);
    }).dispose,
  );
  cleanups.push(
    on(recheckBtn, 'click', async () => {
      rechecking.set(true);
      try {
        const result = await deps.customDomain.recheck();
        recheckNote.set(result.data.note ?? null);
        await domainResource.reload();
      } finally {
        rechecking.set(false);
      }
    }),
  );

  const domainSection = el(
    'div',
    { 'data-bn-subsection': '' },
    el('h3', {}, 'Custom domain'),
    domainEmptyEl,
    domainDetail,
    domainNoteEl,
    recheckBtn,
  );

  const node = el(
    'div',
    {},
    el('h2', {}, 'Branding'),
    el(
      'p',
      { 'data-bn-secondary': '' },
      'Colors, fonts, and email footer applied to outbound communications.',
    ),
    formEl,
    domainSection,
  );

  return {
    node,
    dispose: () => {
      resource.dispose();
      domainResource.dispose();
      for (const fn of cleanups) fn();
    },
  };
}

// ── API Keys panel ───────────────────────────────────────────────────────
function renderApiKeysPanel(deps: PlatformDeps): {
  node: Node;
  dispose: Cleanup;
} {
  const cleanups: Cleanup[] = [];
  const resource = createResource<{ data: ApiKey[] }>(
    () => deps.apiKeys.list(),
    { auto: true },
  );
  const newKey = signal<{ key: string; name: string } | null>(null);

  const list = el('div', { 'data-bn-key-grid': '' });
  cleanups.push(
    effect(() => {
      const keys = resource.data()?.data ?? [];
      clear(list);
      if (keys.length === 0) {
        list.append(el('p', { 'data-bn-empty': '' }, 'No API keys yet.'));
        return;
      }
      for (const key of keys) {
        const deleteBtn = el(
          'button',
          {
            type: 'button',
            'data-bn-button': '',
            'data-bn-variant': 'ghost',
            'data-testid': `settings-key-delete-${key.id}`,
          },
          'Revoke',
        );
        deleteBtn.addEventListener('click', () => {
          void deps.apiKeys.delete(key.id).then(() => resource.reload());
        });
        list.append(
          el(
            'div',
            { 'data-bn-key-row': '' },
            el(
              'div',
              {},
              el('strong', {}, key.name),
              // `scopes` arrives parsed (the API used to hand out the raw
              // JSON string, which rendered as `["read","write"]`).
              el('div', { 'data-bn-secondary': '' }, key.scopes.join(', ')),
            ),
            el('code', {}, `${key.keyPrefix}…`),
            el(
              'span',
              { 'data-bn-secondary': '' },
              key.lastUsedAt
                ? new Date(key.lastUsedAt).toLocaleDateString()
                : 'never',
            ),
            deleteBtn,
          ),
        );
      }
    }).dispose,
  );

  // Create form
  const showCreate = signal(false);
  const nameInput = el('input', {
    type: 'text',
    'data-bn-input': '',
    'data-testid': 'settings-key-name',
    placeholder: 'Server backup',
  }) as HTMLInputElement;
  const scopesInput = el('input', {
    type: 'text',
    'data-bn-input': '',
    'data-testid': 'settings-key-scopes',
    placeholder: 'read,leads',
  }) as HTMLInputElement;
  scopesInput.value = 'read,leads';

  const submitBtn = el(
    'button',
    {
      type: 'submit',
      'data-bn-button': '',
      'data-bn-variant': 'primary',
      'data-testid': 'settings-key-submit',
    },
    'Generate key',
  );

  const createForm = el(
    'form',
    { hidden: true },
    el(
      'div',
      { 'data-bn-field-grid': '' },
      el('div', { 'data-bn-field': '' }, el('label', {}, 'Name'), nameInput),
      el(
        'div',
        { 'data-bn-field': '' },
        el('label', {}, 'Scopes (comma-separated)'),
        scopesInput,
      ),
    ),
    el('footer', { 'data-bn-form-footer': '' }, submitBtn),
  );
  cleanups.push(
    effect(() => {
      if (showCreate()) createForm.removeAttribute('hidden');
      else createForm.setAttribute('hidden', '');
    }).dispose,
    on(createForm, 'submit', async (event) => {
      event.preventDefault();
      const name = nameInput.value.trim();
      if (!name) return;
      const scopes = scopesInput.value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await deps.apiKeys.create({ name, scopes });
      // `key`, not `rawKey`: the API has always called it `key`, so the
      // one-time secret the contractor has to save read "undefined".
      newKey.set({ key: res.data.key, name: res.data.name });
      showCreate.set(false);
      nameInput.value = '';
      await resource.reload();
    }),
  );

  const newKeyNode = el('div', {
    'data-bn-saved': '',
    hidden: true,
    role: 'status',
  });
  cleanups.push(
    effect(() => {
      const nk = newKey();
      if (nk) {
        newKeyNode.textContent = `Save this key — you won't see it again: ${nk.key}`;
        newKeyNode.removeAttribute('hidden');
      } else {
        newKeyNode.setAttribute('hidden', '');
      }
    }).dispose,
  );

  const newBtn = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'primary',
      'data-testid': 'settings-key-toggle',
    },
    'New API key',
  );
  cleanups.push(on(newBtn, 'click', () => showCreate.set(!showCreate.peek())));

  const node = el(
    'div',
    {},
    el(
      'header',
      { 'data-bn-section-header': '' },
      el('h2', {}, 'API Keys'),
      newBtn,
    ),
    newKeyNode,
    createForm,
    list,
  );

  return {
    node,
    dispose: () => {
      resource.dispose();
      for (const fn of cleanups) fn();
    },
  };
}

// ── Security panel ───────────────────────────────────────────────────────

// Both the timeout and the guard itself now live in
// `@basenative/auth-webauthn`, beside the WebAuthn calls they protect —
// `/onboarding` needs exactly the same guard, and a second copy of it is a
// second thing to get wrong. Re-exported here so this module's own tests
// keep testing it through the screen that first needed it.
export { withTimeout };

function renderSecurityPanel(deps: PlatformDeps): {
  node: Node;
  dispose: Cleanup;
} {
  const cleanups: Cleanup[] = [];
  const enrolling = signal(false);
  const message = signal<{ kind: 'success' | 'error'; text: string } | null>(
    null,
  );
  const supportsPasskey =
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined';
  const webauthn = createWebAuthnClient({ api: deps.api });

  const enrollBtn = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'primary',
      'data-testid': 'settings-passkey-enroll',
      disabled: !supportsPasskey,
    },
    'Add a passkey',
  );

  cleanups.push(
    effect(() => {
      enrollBtn.disabled = enrolling() || !supportsPasskey;
      enrollBtn.textContent = enrolling() ? 'Adding…' : 'Add a passkey';
    }).dispose,
    on(enrollBtn, 'click', async () => {
      enrolling.set(true);
      message.set(null);
      try {
        // A browser with no usable authenticator can leave
        // navigator.credentials.create() pending for minutes with no visible
        // prompt, and the button just read "Adding…" forever. Give up and say
        // so — the whole point of this screen is that someone with no passkey
        // finds out, rather than believing they have one.
        await withTimeout(
          webauthn.register(),
          PASSKEY_PROMPT_TIMEOUT_MS,
          'No passkey prompt appeared. This device may not have a passkey it can use — try your phone, or a security key.',
        );
        message.set({
          kind: 'success',
          text: 'Passkey added. You can use it to sign in next time.',
        });
      } catch (err) {
        message.set({
          kind: 'error',
          text:
            err instanceof Error
              ? err.message
              : 'Could not add passkey. Try again or use a different device.',
        });
      } finally {
        enrolling.set(false);
      }
    }),
  );

  const messageNode = el('output', { hidden: true, role: 'status' });
  cleanups.push(
    effect(() => {
      const m = message();
      if (m) {
        messageNode.textContent = m.text;
        messageNode.setAttribute(
          'data-bn-saved',
          m.kind === 'success' ? '' : '',
        );
        if (m.kind === 'error') {
          messageNode.setAttribute('data-bn-error', '');
          messageNode.removeAttribute('data-bn-saved');
        } else {
          messageNode.setAttribute('data-bn-saved', '');
          messageNode.removeAttribute('data-bn-error');
        }
        messageNode.removeAttribute('hidden');
      } else {
        messageNode.setAttribute('hidden', '');
      }
    }).dispose,
  );

  const recovery = renderRecoveryPhoneSection(deps);
  cleanups.push(recovery.dispose);

  const node = el(
    'div',
    {},
    el('h2', {}, 'Security'),
    el(
      'p',
      { 'data-bn-secondary': '' },
      supportsPasskey
        ? 'Add a passkey to this device for fast, password-free sign-in.'
        : 'This browser does not support passkeys. Try a recent Chrome, Safari, Edge, or Firefox.',
    ),
    enrollBtn,
    messageNode,
    recovery.node,
  );

  return {
    node,
    dispose: () => {
      for (const fn of cleanups) fn();
    },
  };
}

// ── Recovery phone ───────────────────────────────────────────────────────
//
// The personal number that gets you back in when every passkey is gone. Two
// steps, because a recovery channel nobody has proved they can receive is not
// a recovery channel: enter the number, then enter the code we text to it.
//
// Deliberately NOT the workspace phone. That number is printed on the
// contractor's own micro-site — texting a sign-in code there would publish
// the way into the account next to the way to book a job. The API refuses it
// (PHONE_IS_PUBLIC) and this copy says so before anyone gets that far.
function renderRecoveryPhoneSection(deps: PlatformDeps): {
  node: HTMLElement;
  dispose: Cleanup;
} {
  const cleanups: Cleanup[] = [];
  const masked = signal<string | null>(null);
  const configured = signal(false);
  const stage = signal<'idle' | 'code'>('idle');
  const busy = signal(false);
  const message = signal<{ kind: 'success' | 'error'; text: string } | null>(
    null,
  );
  let pendingPhone = '';

  const summary = el('p', {
    'data-bn-secondary': '',
    'data-testid': 'settings-recovery-summary',
  });

  const phoneInput = el('input', {
    type: 'tel',
    autocomplete: 'tel',
    inputmode: 'tel',
    placeholder: '(949) 555-0199',
    'data-testid': 'settings-recovery-phone',
  }) as HTMLInputElement;

  const codeInput = el('input', {
    type: 'text',
    autocomplete: 'one-time-code',
    inputmode: 'numeric',
    maxlength: '6',
    'data-testid': 'settings-recovery-code',
  }) as HTMLInputElement;

  const sendBtn = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'secondary',
      'data-testid': 'settings-recovery-send',
    },
    'Send a code',
  ) as HTMLButtonElement;

  const confirmBtn = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'primary',
      'data-testid': 'settings-recovery-confirm',
    },
    'Confirm number',
  ) as HTMLButtonElement;

  const removeBtn = el(
    'button',
    {
      type: 'button',
      'data-bn-button': '',
      'data-bn-variant': 'secondary',
      'data-testid': 'settings-recovery-remove',
    },
    'Remove',
  ) as HTMLButtonElement;

  const phoneField = formField('Personal mobile number', phoneInput);
  const codeField = formField('Six-digit code', codeInput);
  codeField.hidden = true;
  confirmBtn.hidden = true;

  const messageNode = el('output', {
    role: 'status',
    'data-testid': 'settings-recovery-message',
    hidden: true,
  });

  function say(kind: 'success' | 'error', text: string): void {
    message.set({ kind, text });
  }

  function describe(err: unknown): string {
    const e = err as { status?: number; code?: string; message?: string };
    if (e?.code === 'PHONE_IS_PUBLIC' || e?.code === 'PHONE_TAKEN') {
      // The API's own wording for these two is the explanation; repeating it
      // in different words here would only let the two drift.
      return e.message ?? 'That number cannot be used.';
    }
    if (e?.status === 429) return 'Too many attempts. Wait a minute and retry.';
    if (e?.status === 0)
      return "We couldn't reach Greenput. Check your connection.";
    if (e?.status === 401) return 'That code is wrong or has expired.';
    return 'That did not work. Try again.';
  }

  cleanups.push(
    effect(() => {
      const has = configured();
      const at = masked();
      summary.textContent = has
        ? `Codes go to ${at ?? 'your saved number'}. Use a number only you carry — not your business line, which is published on your website.`
        : 'No recovery number yet. Without one, losing every passkey means losing the account. Use a number only you carry — not your business line, which is published on your website.';
      removeBtn.hidden = !has;
    }).dispose,
  );

  cleanups.push(
    effect(() => {
      const onCode = stage() === 'code';
      codeField.hidden = !onCode;
      confirmBtn.hidden = !onCode;
      sendBtn.textContent = onCode ? 'Send another code' : 'Send a code';
    }).dispose,
  );

  cleanups.push(
    effect(() => {
      const working = busy();
      for (const b of [sendBtn, confirmBtn, removeBtn]) b.disabled = working;
    }).dispose,
  );

  cleanups.push(
    effect(() => {
      const m = message();
      if (!m) {
        messageNode.hidden = true;
        return;
      }
      messageNode.textContent = m.text;
      if (m.kind === 'error') {
        messageNode.setAttribute('data-bn-error', '');
        messageNode.removeAttribute('data-bn-saved');
      } else {
        messageNode.setAttribute('data-bn-saved', '');
        messageNode.removeAttribute('data-bn-error');
      }
      messageNode.hidden = false;
    }).dispose,
  );

  cleanups.push(
    on(sendBtn, 'click', () => {
      void (async () => {
        const phone = toE164(phoneInput.value);
        if (!phone) {
          say(
            'error',
            'That does not look like a phone number. Include the country code: +1 949 555 0199, or +44 20 7946 0958.',
          );
          return;
        }
        busy.set(true);
        message.set(null);
        try {
          const started = await deps.recovery.startBinding(phone);
          pendingPhone = phone;
          stage.set('code');
          codeInput.value = '';
          say(
            started.data.delivery === 'log' ? 'error' : 'success',
            started.data.delivery === 'log'
              ? 'No SMS provider is configured on this deployment, so no text will arrive. The code is in the Worker log (`wrangler tail greenput-api`). Until that is set up, a recovery number is not a working way back in — add a passkey instead.'
              : 'Code sent. Enter it below to finish.',
          );
        } catch (err) {
          say('error', describe(err));
        } finally {
          busy.set(false);
        }
      })();
    }),
  );

  cleanups.push(
    on(confirmBtn, 'click', () => {
      void (async () => {
        const code = codeInput.value.replace(/\D/g, '');
        if (code.length !== 6) {
          say('error', 'Enter the six digits from the text message.');
          return;
        }
        busy.set(true);
        message.set(null);
        try {
          const res = await deps.recovery.confirmBinding(pendingPhone, code);
          configured.set(res.data.configured);
          masked.set(res.data.masked);
          stage.set('idle');
          phoneInput.value = '';
          codeInput.value = '';
          say('success', 'Recovery number saved.');
        } catch (err) {
          say('error', describe(err));
        } finally {
          busy.set(false);
        }
      })();
    }),
  );

  cleanups.push(
    on(removeBtn, 'click', () => {
      void (async () => {
        busy.set(true);
        message.set(null);
        try {
          // Ask before removing, not after. This button used to answer "keep
          // at least two passkeys, or you can be locked out" regardless — to
          // an account with none, that is advice for a situation the reader is
          // not in, delivered one click after their last way in was deleted.
          let passkeys: number | null = null;
          try {
            passkeys = (await deps.recovery.passkeyCount()).data.count;
          } catch {
            // If we cannot count them, do not pretend to know. The warning
            // below falls back to the unconditional one.
          }

          if (passkeys === 0) {
            const proceed =
              typeof window === 'undefined' ||
              window.confirm(
                'This account has no passkey. Removing your recovery number leaves nothing that can sign you in once this session ends. Remove it anyway?',
              );
            if (!proceed) {
              busy.set(false);
              return;
            }
          }

          const res = await deps.recovery.clear();
          configured.set(res.data.configured);
          masked.set(res.data.masked);
          say(
            passkeys === 0 ? 'error' : 'success',
            passkeys === 0
              ? 'Recovery number removed. This account now has no way to sign in after this session ends — add a passkey below.'
              : passkeys === 1
                ? 'Recovery number removed. One passkey is all that is left, so losing that device loses the account.'
                : 'Recovery number removed.',
          );
        } catch (err) {
          say('error', describe(err));
        } finally {
          busy.set(false);
        }
      })();
    }),
  );

  void (async () => {
    try {
      const res = await deps.recovery.status();
      configured.set(res.data.configured);
      masked.set(res.data.masked);
    } catch {
      // Non-fatal: the section still works, it just cannot say what is saved.
    }
  })();

  const node = el(
    'section',
    { 'data-bn-recovery-phone': '' },
    el('h3', {}, 'Recovery phone'),
    summary,
    phoneField,
    codeField,
    el('div', { 'data-bn-form-footer': '' }, sendBtn, confirmBtn, removeBtn),
    messageNode,
  );

  return {
    node,
    dispose: () => {
      for (const fn of cleanups) fn();
    },
  };
}

function toggleAttr(node: HTMLElement, on: boolean, attr: string): void {
  if (on) node.removeAttribute(attr);
  else node.setAttribute(attr, '');
}
