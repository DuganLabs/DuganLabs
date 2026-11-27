import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSqliteD1 } from '@greenput/shared/testing';
import {
  API_KEY_SCOPES,
  checkWire,
  checkWireList,
  describeWireProblems,
  toWire,
  toWireList,
  WIRE_API_KEY,
  WIRE_API_KEY_CREATED,
  WIRE_BRANDING,
  WIRE_CAMPAIGN,
  WIRE_CHANGE_ORDER,
  WIRE_CHANGE_ORDER_EVENT,
  WIRE_CUSTOMER,
  WIRE_ENTITIES,
  WIRE_ESTIMATE,
  WIRE_INSTALLED_PLUGIN,
  WIRE_INVENTORY_ITEM,
  WIRE_INVENTORY_TRANSACTION,
  WIRE_JOB,
  WIRE_JOB_LINE_ITEM,
  WIRE_LEAD,
  WIRE_NOTIFICATION_PREFERENCE,
  WIRE_OPPORTUNITY,
  WIRE_PLUGIN,
  WIRE_PLUGIN_INSTALLATION,
  WIRE_REVIEW,
  WIRE_REVIEW_REQUEST,
  WIRE_SCHEDULE_BLOCK,
  WIRE_SUBSCRIPTION,
  WIRE_VEHICLE,
  WIRE_WEBHOOK,
  WIRE_WEBHOOK_DELIVERY,
  WIRE_WORKSPACE,
  WIRE_WORKSPACE_USER,
  WIRE_AVAILABILITY_DAY,
  WIRE_AVAILABILITY_EXCEPTION,
  WIRE_WORKSPACE_AVAILABILITY,
  WIRE_CHAT_ROOM,
  WIRE_CHAT_MESSAGE,
  WIRE_CHAT_UNREAD,
  type ApiKey,
  type ApiKeyCreated,
  type AvailabilityDay,
  type AvailabilityException,
  type Branding,
  type Campaign,
  type ChangeOrder,
  type ChangeOrderEvent,
  type ChatMessage,
  type ChatRoom,
  type ChatUnread,
  type Customer,
  type Estimate,
  type EstimateLineItem,
  type InstalledPlugin,
  type InventoryItem,
  type InventoryTransaction,
  type Job,
  type JobLineItem,
  type Lead,
  type NotificationPreference,
  type Opportunity,
  type Plugin,
  type PluginInstallation,
  type Review,
  type ReviewRequest,
  type ScheduleBlock,
  type Subscription,
  type Vehicle,
  type Webhook,
  type WebhookDelivery,
  type WireEntity,
  type Workspace,
  type WorkspaceAvailability,
  type WorkspaceUser,
} from './index';

const ROOT = resolve(__dirname, '../../../..');
const SCHEMA = resolve(ROOT, 'schema.sql');

// ── 1. THE CONTRACT AGAINST THE DATABASE ─────────────────────
//
// Every column the contract names must exist on the table it names. This is
// the check that would have caught `InventoryTransaction.unitCost` (a model
// field for a column `inventory_transactions` has never had) and
// `Workspace.licenseNumber` being read as `license_number` when the column is
// `license_num`.

describe('the wire contract resolves against schema.sql', () => {
  const sqlite = createSqliteD1({ files: [SCHEMA] });
  const columnsOf = (table: string): Set<string> =>
    new Set(
      sqlite.raw
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row: unknown) => String((row as { name: unknown }).name)),
    );

  it.each(WIRE_ENTITIES.map((e) => [e.name, e] as const))(
    '%s reads only columns that exist',
    (_name, entity: WireEntity) => {
      const available = new Set([
        ...columnsOf(entity.table),
        ...(entity.joinedTables ?? []).flatMap((t) => [...columnsOf(t)]),
      ]);
      expect(available.size).toBeGreaterThan(0);

      const missing: string[] = [];
      for (const [field, spec] of Object.entries(entity.fields)) {
        const leaves =
          'group' in spec
            ? Object.entries(spec.group).map(
                ([member, leaf]) => [`${field}.${member}`, leaf] as const,
              )
            : [[field, spec] as const];
        for (const [path, leaf] of leaves) {
          if (leaf.fromRoute) continue;
          if (!available.has(leaf.column)) {
            missing.push(`${path} -> ${entity.table}.${leaf.column}`);
          }
        }
      }
      expect(missing).toEqual([]);
    },
  );
});

// ── 2. CLOSED VALUE SETS AGAINST THEIR CHECK CONSTRAINTS ─────
//
// A union that has drifted from the column's CHECK is a 500 waiting for the
// first row that uses the value only one side knows about.

describe('closed value sets match schema.sql CHECK constraints', () => {
  const schemaSrc = readFileSync(SCHEMA, 'utf8');

  /** `CHECK(col IN ('a','b'))` on the named table, if there is one. */
  function checkValues(table: string, column: string): string[] | null {
    const create = new RegExp(
      `CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`,
    ).exec(schemaSrc);
    if (!create) return null;
    const clause = new RegExp(
      `\\b${column}\\b[\\s\\S]{0,200}?CHECK\\(\\s*${column} IN \\(([^)]*)\\)`,
    ).exec(create[1] as string);
    if (!clause) return null;
    return (clause[1] as string)
      .split(',')
      .map((value) => value.trim().replace(/^'|'$/g, ''))
      .filter(Boolean);
  }

  const cases = WIRE_ENTITIES.flatMap((entity) =>
    Object.entries(entity.fields).flatMap(([field, spec]) => {
      const leaves =
        'group' in spec
          ? Object.entries(spec.group).map(
              ([member, leaf]) => [`${field}.${member}`, leaf] as const,
            )
          : [[field, spec] as const];
      return leaves
        .filter(([, leaf]) => leaf.values !== undefined)
        .map(
          ([path, leaf]) =>
            [
              `${entity.name}.${path}`,
              entity,
              leaf.column,
              leaf.values!,
            ] as const,
        );
    }),
  );

  it('there are value sets to check', () => {
    expect(cases.length).toBeGreaterThan(10);
  });

  it.each(cases)('%s', (_label, entity, column, values) => {
    const declared = checkValues(entity.table, column);
    // notification_preferences.event_type carries no CHECK (see ./enums), and
    // neither does a column reached through a JOIN table this helper does not
    // parse. No CHECK means nothing to disagree with.
    if (declared === null) return;
    expect([...values].sort()).toEqual([...declared].sort());
  });
});

// ── 3. THE MODELS AGAINST THE CONTRACT ───────────────────────
//
// Each sample below is typed `Required<Model>`, so TypeScript refuses to
// compile this file until every field of the model — optional ones included —
// appears in it. `checkWire` then rejects any key the contract does not map.
// Adding a field to a model therefore forces it into the contract, and the
// contract forces it to name a real column (check 1 above).
//
// `shared-models:test` runs `tsc --noEmit` before vitest for exactly this
// reason: the type half of the check has to run somewhere CI looks.

const SAMPLES: ReadonlyArray<readonly [string, WireEntity, object]> = [
  [
    'Lead',
    WIRE_LEAD,
    {
      id: 'lead-1',
      firstName: 'Alex',
      lastName: 'Reed',
      contact: {
        email: 'alex@example.com',
        phone: '5125550142',
        preferredContact: 'email',
      },
      address: {
        street: '1 Way',
        city: 'Rivertown',
        state: 'TX',
        zip: '78701',
      },
      status: 'qualified',
      source: 'website',
      campaignId: 'camp-1',
      notes: '',
      estimatedValue: 265213,
      serviceType: 'Panel Upgrade',
      convertedToOpportunityId: 'opp-1',
      qualifiedAt: '2026-09-01T00:00:00.000Z',
      acceptedAt: '2026-09-02T00:00:00.000Z',
      withdrawnAt: '2026-09-03T00:00:00.000Z',
      withdrawnReason: 'schedule_no_longer_works',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      createdBy: 'user-1',
    } satisfies Required<Lead>,
  ],
  [
    'JobLineItem',
    WIRE_JOB_LINE_ITEM,
    {
      id: 'li-1',
      description: '200A panel',
      quantity: 1,
      unitPrice: 220000,
      total: 220000,
    } satisfies Required<JobLineItem>,
  ],
  [
    'Job',
    WIRE_JOB,
    {
      id: 'job-1',
      opportunityId: 'opp-1',
      customerId: 'cust-1',
      jobNumber: '#1001',
      title: 'Panel upgrade',
      status: 'scheduled',
      address: {
        street: '1 Way',
        city: 'Rivertown',
        state: 'TX',
        zip: '78701',
      },
      scheduledStart: '2026-09-12T14:00:00.000Z',
      scheduledEnd: '2026-09-12T16:00:00.000Z',
      actualStart: '2026-09-12T14:05:00.000Z',
      actualEnd: '2026-09-12T15:40:00.000Z',
      lineItems: [],
      total: 265213,
      notes: '',
      invoicedAt: '2026-09-13T00:00:00.000Z',
      paidAt: '2026-09-14T00:00:00.000Z',
      assignedTo: 'user-2',
      invoiceToken: '3b0d1a2c-7f4e-4a5b-9c8d-0e1f2a3b4c5d',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      createdBy: 'user-1',
    } satisfies Required<Job>,
  ],
  [
    'ScheduleBlock',
    WIRE_SCHEDULE_BLOCK,
    {
      id: 'job-1',
      title: 'Panel upgrade',
      jobNumber: '#1001',
      status: 'completed',
      start: '2026-09-12T14:00:00.000Z',
      end: '2026-09-12T16:00:00.000Z',
      customerId: 'cust-1',
      customerName: 'Jane Doe',
      location: '2 Elm St, Rivertown',
      assignedTo: 'user-2',
      assigneeName: 'Bo Tech',
    } satisfies Required<ScheduleBlock>,
  ],
  [
    'Customer',
    WIRE_CUSTOMER,
    {
      id: 'cust-1',
      firstName: 'Jane',
      lastName: 'Doe',
      company: 'Doe Enterprises',
      contact: {
        email: 'jane@example.com',
        phone: '5125550143',
        preferredContact: 'phone',
      },
      address: {
        street: '2 Way',
        city: 'Rivertown',
        state: 'TX',
        zip: '78702',
      },
      notes: '',
      consentGivenAt: '2026-09-01T00:00:00.000Z',
      consentMethod: 'form',
      totalJobValue: 850000,
      jobCount: 2,
      jobs: [],
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      createdBy: 'user-1',
    } satisfies Required<Customer>,
  ],
  [
    'Opportunity',
    WIRE_OPPORTUNITY,
    {
      id: 'opp-1',
      leadId: 'lead-1',
      customerId: 'cust-1',
      title: '200A Panel Upgrade',
      status: 'won',
      value: 265213,
      serviceType: 'Panel Upgrade',
      notes: '',
      proposalSentAt: '2026-09-02T00:00:00.000Z',
      closedAt: '2026-09-05T00:00:00.000Z',
      convertedToJobId: 'job-1',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      createdBy: 'user-1',
    } satisfies Required<Opportunity>,
  ],
  [
    'Campaign',
    WIRE_CAMPAIGN,
    {
      id: 'camp-1',
      name: 'Spring postcards',
      status: 'active',
      channel: 'postcard',
      targetArea: '78701',
      budget: 150000,
      spent: 68000,
      leadsGenerated: 12,
      leadCount: 3,
      startDate: '2026-09-01T00:00:00.000Z',
      endDate: '2026-10-01T00:00:00.000Z',
      notes: '',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      createdBy: 'user-1',
    } satisfies Required<Campaign>,
  ],
  [
    'Estimate',
    WIRE_ESTIMATE,
    {
      id: 'est-1',
      opportunityId: 'opp-1',
      customerId: 'cust-1',
      estimateNumber: 'EST-1001',
      title: '200A Panel Upgrade',
      status: 'accepted',
      lineItems: [
        {
          id: 'li-1',
          type: 'material',
          description: '200A panel replacement',
          quantity: 1,
          unitPrice: 220000,
          total: 220000,
        } satisfies Required<EstimateLineItem>,
      ],
      subtotal: 245000,
      taxRate: 8.25,
      taxAmount: 20213,
      total: 265213,
      notes: '',
      validUntil: '2026-10-01T00:00:00.000Z',
      sentAt: '2026-09-02T00:00:00.000Z',
      acceptedAt: '2026-09-05T00:00:00.000Z',
      rejectedAt: '2026-09-06T00:00:00.000Z',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      createdBy: 'user-1',
      quoteSessionId: 'qs-1',
    } satisfies Required<Estimate>,
  ],
  [
    'ChangeOrderEvent',
    WIRE_CHANGE_ORDER_EVENT,
    {
      id: 'coe-1',
      changeOrderId: 'co-1',
      action: 'approved',
      actorUserId: 'user-1',
      note: 'Jane approved by phone.',
      totalAfter: 324500,
      createdAt: '2026-10-20T10:12:00.000Z',
    } satisfies Required<ChangeOrderEvent>,
  ],
  [
    'ChangeOrder',
    WIRE_CHANGE_ORDER,
    {
      id: 'co-1',
      jobId: 'job-1',
      estimateId: 'est-1',
      number: 'CO-1001',
      title: 'Add a subpanel in the garage',
      reason: 'Homeowner asked on site.',
      status: 'approved',
      lineItems: [
        {
          id: 'coli-1',
          type: 'material',
          description: '100A subpanel',
          quantity: 1,
          unitPrice: 42000,
          total: 42000,
        } satisfies Required<EstimateLineItem>,
      ],
      priceDelta: 42000,
      totalBefore: 245000,
      decidedBy: 'user-1',
      decidedAt: '2026-10-20T10:12:00.000Z',
      decisionNote: 'Jane approved by phone.',
      events: [],
      createdAt: '2026-10-20T09:00:00.000Z',
      updatedAt: '2026-10-20T10:12:00.000Z',
      createdBy: 'user-2',
    } satisfies Required<ChangeOrder>,
  ],
  [
    'InventoryTransaction',
    WIRE_INVENTORY_TRANSACTION,
    {
      id: 'tx-1',
      workspaceId: 'ws-1',
      itemId: 'item-1',
      jobId: 'job-1',
      type: 'purchase',
      quantity: 10,
      notes: '',
      createdAt: '2026-09-01T00:00:00.000Z',
      createdBy: 'user-1',
    } satisfies Required<InventoryTransaction>,
  ],
  [
    'InventoryItem',
    WIRE_INVENTORY_ITEM,
    {
      id: 'item-1',
      workspaceId: 'ws-1',
      name: '12/2 Romex',
      sku: 'ROMEX-12-2',
      description: '',
      category: 'wire',
      quantity: 40,
      minQuantity: 10,
      unitCost: 12900,
      unitPrice: 19900,
      supplier: 'Supply Co',
      location: 'Van 1',
      transactions: [],
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    } satisfies Required<InventoryItem>,
  ],
  [
    'Vehicle',
    WIRE_VEHICLE,
    {
      id: 'veh-1',
      workspaceId: 'ws-1',
      name: 'Van 1',
      make: 'Ford',
      model: 'Transit',
      year: 2022,
      licensePlate: 'TX-1234',
      vin: '1FTBW2CM4NKA00000',
      status: 'active',
      mileage: 42000,
      notes: '',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    } satisfies Required<Vehicle>,
  ],
  [
    'Review',
    WIRE_REVIEW,
    {
      id: 'rev-1',
      workspaceId: 'ws-1',
      customerId: 'cust-1',
      jobId: 'job-1',
      platform: 'google',
      rating: 5,
      content: 'Great work',
      authorName: 'Jane D.',
      reviewUrl: 'https://example.com/r/1',
      responded: true,
      responseText: 'Thank you!',
      fetchedAt: '2026-09-01T00:00:00.000Z',
      createdAt: '2026-09-01T00:00:00.000Z',
    } satisfies Required<Review>,
  ],
  [
    'ReviewRequest',
    WIRE_REVIEW_REQUEST,
    {
      id: 'rr-1',
      workspaceId: 'ws-1',
      customerId: 'cust-1',
      jobId: 'job-1',
      channel: 'email',
      status: 'sent',
      sentAt: '2026-09-01T00:00:00.000Z',
      completedAt: '2026-09-02T00:00:00.000Z',
      createdAt: '2026-09-01T00:00:00.000Z',
    } satisfies Required<ReviewRequest>,
  ],
  [
    'Plugin',
    WIRE_PLUGIN,
    {
      id: 'plug-1',
      name: 'QuickBooks',
      slug: 'quickbooks',
      description: '',
      version: '1.0.0',
      author: 'Greenput',
      iconUrl: 'https://example.com/i.png',
      category: 'accounting',
      events: [],
      configSchema: {},
      active: true,
      createdAt: '2026-09-01T00:00:00.000Z',
    } satisfies Required<Plugin>,
  ],
  [
    'PluginInstallation',
    WIRE_PLUGIN_INSTALLATION,
    {
      id: 'inst-1',
      workspaceId: 'ws-1',
      pluginId: 'plug-1',
      config: {},
      enabled: true,
      installedAt: '2026-09-01T00:00:00.000Z',
      installedBy: 'user-1',
    } satisfies Required<PluginInstallation>,
  ],
  [
    'InstalledPlugin',
    WIRE_INSTALLED_PLUGIN,
    {
      id: 'inst-1',
      workspaceId: 'ws-1',
      pluginId: 'plug-1',
      config: {},
      enabled: true,
      installedAt: '2026-09-01T00:00:00.000Z',
      installedBy: 'user-1',
      name: 'QuickBooks',
      slug: 'quickbooks',
      description: '',
      version: '1.0.0',
      author: 'Greenput',
      iconUrl: 'https://example.com/i.png',
      category: 'accounting',
      events: [],
    } satisfies Required<InstalledPlugin>,
  ],
  [
    'WebhookDelivery',
    WIRE_WEBHOOK_DELIVERY,
    {
      id: 'del-1',
      webhookId: 'hook-1',
      eventType: 'lead.created',
      statusCode: 200,
      attempts: 1,
      deliveredAt: '2026-09-01T00:00:00.000Z',
      createdAt: '2026-09-01T00:00:00.000Z',
    } satisfies Required<WebhookDelivery>,
  ],
  [
    'Webhook',
    WIRE_WEBHOOK,
    {
      id: 'hook-1',
      workspaceId: 'ws-1',
      url: 'https://example.com/hook',
      events: [],
      secret: 'shhh',
      active: true,
      deliveries: [],
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    } satisfies Required<Webhook>,
  ],
  [
    'ApiKey',
    WIRE_API_KEY,
    {
      id: 'key-1',
      workspaceId: 'ws-1',
      name: 'CI key',
      keyPrefix: 'abcdefgh',
      scopes: [...API_KEY_SCOPES],
      lastUsedAt: '2026-09-01T00:00:00.000Z',
      expiresAt: '2026-10-01T00:00:00.000Z',
      createdAt: '2026-09-01T00:00:00.000Z',
      createdBy: 'user-1',
    } satisfies Required<ApiKey>,
  ],
  [
    'ApiKeyCreated',
    WIRE_API_KEY_CREATED,
    {
      id: 'key-1',
      workspaceId: 'ws-1',
      name: 'CI key',
      keyPrefix: 'abcdefgh',
      scopes: ['read'],
      lastUsedAt: '2026-09-01T00:00:00.000Z',
      expiresAt: '2026-10-01T00:00:00.000Z',
      createdAt: '2026-09-01T00:00:00.000Z',
      createdBy: 'user-1',
      key: 'gp_0123456789abcdef0123456789abcdef',
    } satisfies Required<ApiKeyCreated>,
  ],
  [
    'Branding',
    WIRE_BRANDING,
    {
      id: 'br-1',
      workspaceId: 'ws-1',
      logoUrl: 'https://example.com/l.png',
      faviconUrl: 'https://example.com/f.png',
      primaryColor: '#10b981',
      secondaryColor: '#1f2937',
      accentColor: '#3b82f6',
      fontFamily: 'system-ui',
      customDomain: 'example.com',
      emailFooter: '',
      updatedAt: '2026-09-01T00:00:00.000Z',
    } satisfies Required<Branding>,
  ],
  [
    'NotificationPreference',
    WIRE_NOTIFICATION_PREFERENCE,
    {
      id: 'np-1',
      userId: 'user-1',
      eventType: 'new_lead',
      channel: 'email',
      enabled: true,
    } satisfies Required<NotificationPreference>,
  ],
  [
    'WorkspaceUser',
    WIRE_WORKSPACE_USER,
    {
      id: 'user-1',
      firstName: 'Dana',
      lastName: 'Ortiz',
      email: 'dana@example.com',
      role: 'owner',
      avatarInitials: 'DO',
      lastSeenAt: '2026-09-01T00:00:00.000Z',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    } satisfies Required<WorkspaceUser>,
  ],
  [
    'Workspace',
    WIRE_WORKSPACE,
    {
      id: 'ws-1',
      name: 'Rivertown Electric',
      slug: 'demo',
      trade: 'electrical',
      phone: '5125550142',
      email: 'hello@example.com',
      address: {
        street: '1 Way',
        city: 'Rivertown',
        state: 'TX',
        zip: '78701',
      },
      licenseNumber: 'TECL-1234',
      logoUrl: 'https://example.com/l.png',
      serviceTypes: ['electrical', 'hvac'],
      serviceArea: 'Rivertown metro',
      serviceRadiusMiles: 25,
      createdAt: '2026-09-01T00:00:00.000Z',
      customHostname: 'rivertown.example',
      customDomainStatus: 'active',
      customDomainSetupFeePaidAt: '2026-09-01T00:00:00.000Z',
    } satisfies Required<Workspace>,
  ],
  [
    'Subscription',
    WIRE_SUBSCRIPTION,
    {
      id: 'sub-1',
      plan: 'pro',
      status: 'active',
      currentPeriodStart: '2026-09-01T00:00:00.000Z',
      currentPeriodEnd: '2026-10-01T00:00:00.000Z',
      cancelAtPeriodEnd: false,
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    } satisfies Required<Subscription>,
  ],
  [
    'AvailabilityDay',
    WIRE_AVAILABILITY_DAY,
    {
      id: 'avail-1',
      weekday: 1,
      isOpen: true,
      opensAt: '08:00',
      closesAt: '17:00',
    } satisfies Required<AvailabilityDay>,
  ],
  [
    'AvailabilityException',
    WIRE_AVAILABILITY_EXCEPTION,
    {
      id: 'exc-1',
      date: '2026-12-25',
      isOpen: false,
      opensAt: '08:00',
      closesAt: '12:00',
      reason: 'Christmas Day',
    } satisfies Required<AvailabilityException>,
  ],
  [
    'WorkspaceAvailability',
    WIRE_WORKSPACE_AVAILABILITY,
    {
      timezone: 'America/Chicago',
      bookingLeadHours: 24,
      bookingHorizonDays: 30,
      travelBufferMinutes: 30,
      concurrentJobs: 1,
      bookable: true,
      week: [
        {
          id: 'avail-1',
          weekday: 1,
          isOpen: true,
          opensAt: '08:00',
          closesAt: '17:00',
        },
      ],
      exceptions: [{ id: 'exc-1', date: '2026-12-25', isOpen: false }],
    } satisfies Required<WorkspaceAvailability>,
  ],
  [
    'ChatRoom',
    WIRE_CHAT_ROOM,
    {
      id: 'room-1',
      name: 'Jane Doe',
      entityType: 'customer',
      entityId: 'cust-1',
      createdBy: 'user-1',
      createdAt: '2026-09-14T00:00:00.000Z',
    } satisfies Required<ChatRoom>,
  ],
  [
    'ChatMessage',
    WIRE_CHAT_MESSAGE,
    {
      id: 'msg-1',
      userId: 'user-1',
      userName: 'Dana Ortiz',
      content: 'On my way.',
      createdAt: '2026-09-14T00:00:00.000Z',
    } satisfies Required<ChatMessage>,
  ],
  [
    'ChatUnread',
    WIRE_CHAT_UNREAD,
    {
      roomId: 'room-1',
      name: 'Jane Doe',
      unreadCount: 2,
    } satisfies Required<ChatUnread>,
  ],
];

describe('every model field is mapped by the contract', () => {
  it('covers every entity', () => {
    expect(SAMPLES.map(([, entity]) => entity.name).sort()).toEqual(
      WIRE_ENTITIES.map((entity) => entity.name).sort(),
    );
  });

  it.each(SAMPLES.map(([name, entity, sample]) => [name, entity, sample]))(
    '%s',
    (_name, entity, sample) => {
      const problems = checkWire(entity as WireEntity, sample);
      expect(describeWireProblems(problems)).toBe('');
    },
  );
});

// ── 4. SERIALIZATION ─────────────────────────────────────────

const LEAD_ROW = {
  id: 'lead-1',
  workspace_id: 'ws-1',
  first_name: 'Alex',
  last_name: 'Reed',
  email: 'alex@example.com',
  phone: '5125550142',
  preferred_contact: 'email',
  street: '1 Way',
  city: 'Rivertown',
  state: 'TX',
  zip: '78701',
  status: 'qualified',
  source: 'website',
  campaign_id: null,
  service_type: 'Panel Upgrade',
  estimated_value: 265213,
  notes: 'call back',
  converted_to_opportunity_id: null,
  qualified_at: '2026-09-01T00:00:00.000Z',
  accepted_at: null,
  withdrawn_at: null,
  withdrawn_reason: null,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  created_by: 'user-1',
  // The LEFT JOIN alias the list query adds. Not part of the model.
  campaign_name: 'Spring postcards',
};

describe('toWire', () => {
  it('turns a D1 row into exactly the declared model', () => {
    expect(toWire<Lead>(WIRE_LEAD, LEAD_ROW)).toEqual({
      id: 'lead-1',
      firstName: 'Alex',
      lastName: 'Reed',
      contact: {
        email: 'alex@example.com',
        phone: '5125550142',
        preferredContact: 'email',
      },
      address: {
        street: '1 Way',
        city: 'Rivertown',
        state: 'TX',
        zip: '78701',
      },
      status: 'qualified',
      source: 'website',
      notes: 'call back',
      estimatedValue: 265213,
      serviceType: 'Panel Upgrade',
      qualifiedAt: '2026-09-01T00:00:00.000Z',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      createdBy: 'user-1',
    });
  });

  it('drops columns the model does not declare', () => {
    const lead = toWire<Lead>(WIRE_LEAD, LEAD_ROW) as unknown as Record<
      string,
      unknown
    >;
    expect('workspace_id' in lead).toBe(false);
    expect('campaign_name' in lead).toBe(false);
    expect('first_name' in lead).toBe(false);
  });

  it('omits an optional field whose column is NULL', () => {
    const lead = toWire<Lead>(WIRE_LEAD, LEAD_ROW) as unknown as Record<
      string,
      unknown
    >;
    expect('campaignId' in lead).toBe(false);
    expect('acceptedAt' in lead).toBe(false);
  });

  it('omits an optional field whose column the endpoint did not SELECT', () => {
    const narrow = { ...LEAD_ROW } as Record<string, unknown>;
    delete narrow['qualified_at'];
    const lead = toWire<Lead>(WIRE_LEAD, narrow) as unknown as Record<
      string,
      unknown
    >;
    expect('qualifiedAt' in lead).toBe(false);
  });

  it('falls back to the type zero for a required field that is NULL', () => {
    // The live databases hold NULLs in columns schema.sql declares NOT NULL —
    // see migrations/000-baseline-notnull.tsv. A reader typed `notes: string`
    // gets '' rather than null.
    const lead = toWire<Lead>(WIRE_LEAD, { ...LEAD_ROW, notes: null });
    expect(lead.notes).toBe('');
  });

  it('converts SQLite 0/1 to a real boolean', () => {
    expect(
      toWire<Review>(WIRE_REVIEW, {
        id: 'r1',
        workspace_id: 'ws-1',
        platform: 'google',
        rating: 5,
        content: '',
        author_name: 'A',
        responded: 1,
        created_at: 'now',
      }).responded,
    ).toBe(true);
    expect(
      toWire<Review>(WIRE_REVIEW, {
        id: 'r1',
        workspace_id: 'ws-1',
        platform: 'google',
        rating: 5,
        content: '',
        author_name: 'A',
        responded: 0,
        created_at: 'now',
      }).responded,
    ).toBe(false);
  });

  it('parses a JSON TEXT column', () => {
    const key = toWire<ApiKey>(WIRE_API_KEY, {
      id: 'k1',
      workspace_id: 'ws-1',
      name: 'CI',
      key_prefix: 'abcdefgh',
      scopes: '["read","leads"]',
      created_at: 'now',
      created_by: 'user-1',
    });
    expect(key.scopes).toEqual(['read', 'leads']);
  });

  it('falls back to an empty array when a JSON column is unparseable', () => {
    const key = toWire<ApiKey>(WIRE_API_KEY, {
      id: 'k1',
      workspace_id: 'ws-1',
      name: 'CI',
      key_prefix: 'abcdefgh',
      scopes: 'not json',
      created_at: 'now',
      created_by: 'user-1',
    });
    expect(key.scopes).toEqual([]);
  });

  it('rounds a money column to whole cents', () => {
    // A REAL column can hold 265212.99999999994 after a float multiply.
    const job = toWire<Job>(WIRE_JOB, {
      id: 'j1',
      opportunity_id: 'o1',
      customer_id: 'c1',
      job_number: '#1',
      title: 'T',
      status: 'paid',
      street: '',
      city: '',
      state: '',
      zip: '',
      scheduled_start: 'a',
      scheduled_end: 'b',
      total: 265212.99999999994,
      notes: '',
      created_at: 'now',
      updated_at: 'now',
      created_by: 'user-1',
    });
    expect(job.total).toBe(265213);
  });

  it('derives avatarInitials from the name columns', () => {
    const user = toWire<WorkspaceUser>(WIRE_WORKSPACE_USER, {
      id: 'u1',
      first_name: 'dana',
      last_name: 'ortiz',
      email: 'd@example.com',
      role: 'owner',
      last_seen_at: null,
      created_at: 'now',
      updated_at: 'now',
    });
    expect(user.avatarInitials).toBe('DO');
  });

  it('derives leadCount from the lead_count alias the campaign reads SELECT', () => {
    const row = {
      id: 'camp-1',
      name: 'Spring postcards',
      status: 'active',
      channel: 'postcard',
      leads_generated: 40,
      start_date: 'now',
      notes: '',
      created_at: 'now',
      updated_at: 'now',
      created_by: 'user-1',
    };
    const counted = toWire<Campaign>(WIRE_CAMPAIGN, { ...row, lead_count: 3 });
    expect(counted.leadsGenerated).toBe(40);
    expect(counted.leadCount).toBe(3);
    // A read that forgot the join answers 0, not the typed number.
    expect(toWire<Campaign>(WIRE_CAMPAIGN, row).leadCount).toBe(0);
  });

  it('leaves a route-supplied field to the route', () => {
    const created = toWire<Record<string, unknown>>(WIRE_API_KEY_CREATED, {
      id: 'k1',
      workspace_id: 'ws-1',
      name: 'CI',
      key_prefix: 'abcdefgh',
      key_hash: 'never-handed-out',
      scopes: '["read"]',
      created_at: 'now',
      created_by: 'user-1',
    });
    expect('key' in created).toBe(false);
  });

  it('maps a list', () => {
    expect(toWireList<Lead>(WIRE_LEAD, [LEAD_ROW, LEAD_ROW])).toHaveLength(2);
    expect(toWireList<Lead>(WIRE_LEAD, null)).toEqual([]);
  });
});

// ── 5. VALIDATION ────────────────────────────────────────────

describe('checkWire', () => {
  it('rejects the raw D1 row — the shape that shipped to production', () => {
    const problems = checkWire(WIRE_LEAD, LEAD_ROW);
    const paths = problems.map((p) => p.path);
    expect(paths).toContain('Lead.contact');
    expect(paths).toContain('Lead.firstName');
    expect(paths).toContain('Lead.first_name');
    expect(problems.length).toBeGreaterThan(10);
  });

  it('accepts what toWire produces', () => {
    expect(checkWire(WIRE_LEAD, toWire(WIRE_LEAD, LEAD_ROW))).toEqual([]);
  });

  it('rejects a dollars amount in a cents field', () => {
    const job = {
      ...toWire<Job>(WIRE_JOB, {
        id: 'j1',
        opportunity_id: 'o1',
        customer_id: 'c1',
        job_number: '#1',
        title: 'T',
        status: 'paid',
        street: '',
        city: '',
        state: '',
        zip: '',
        scheduled_start: 'a',
        scheduled_end: 'b',
        total: 0,
        notes: '',
        created_at: 'now',
        updated_at: 'now',
        created_by: 'user-1',
      }),
      total: 2652.13,
    };
    const problems = checkWire(WIRE_JOB, job);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.path).toBe('Job.total');
    expect(problems[0]?.problem).toMatch(/integer cents/);
  });

  it('rejects a value outside a closed set', () => {
    const lead = {
      ...toWire<Lead>(WIRE_LEAD, LEAD_ROW),
      status: 'archived' as Lead['status'],
    };
    expect(checkWire(WIRE_LEAD, lead).map((p) => p.problem)).toEqual([
      expect.stringContaining('is not one of'),
    ]);
  });

  it('rejects a 0/1 left where a boolean belongs', () => {
    const review = {
      ...toWire<Review>(WIRE_REVIEW, {
        id: 'r1',
        workspace_id: 'ws-1',
        platform: 'google',
        rating: 5,
        content: '',
        author_name: 'A',
        responded: 1,
        created_at: 'now',
      }),
      responded: 1 as unknown as boolean,
    };
    expect(checkWire(WIRE_REVIEW, review).map((p) => p.path)).toEqual([
      'Review.responded',
    ]);
  });

  it('rejects an unparsed JSON string', () => {
    const key = {
      ...toWire<ApiKey>(WIRE_API_KEY, {
        id: 'k1',
        workspace_id: 'ws-1',
        name: 'CI',
        key_prefix: 'abcdefgh',
        scopes: '["read"]',
        created_at: 'now',
        created_by: 'user-1',
      }),
      scopes: '["read"]' as unknown as ApiKey['scopes'],
    };
    expect(checkWire(WIRE_API_KEY, key).map((p) => p.path)).toEqual([
      'ApiKey.scopes',
    ]);
  });

  it('validates declared children and rejects everything else extra', () => {
    const job = {
      ...toWire<Job>(WIRE_JOB, {
        id: 'j1',
        opportunity_id: 'o1',
        customer_id: 'c1',
        job_number: '#1',
        title: 'T',
        status: 'paid',
        street: '',
        city: '',
        state: '',
        zip: '',
        scheduled_start: 'a',
        scheduled_end: 'b',
        total: 0,
        notes: '',
        created_at: 'now',
        updated_at: 'now',
        created_by: 'user-1',
      }),
      lineItems: [{ id: 'li', description: 'd', quantity: 1, unitPrice: 1 }],
      customer_first_name: 'Jane',
    };
    const problems = checkWire(WIRE_JOB, job);
    expect(problems.map((p) => `${p.path}: ${p.problem}`)).toEqual([
      'Job.lineItems[0].total: missing',
      'Job.customer_first_name: unexpected key — not part of the declared model',
    ]);
  });

  it('reports the index in a list', () => {
    const problems = checkWireList(WIRE_LEAD, [
      toWire(WIRE_LEAD, LEAD_ROW),
      LEAD_ROW,
    ]);
    expect(problems.every((p) => p.path.startsWith('Lead[1]'))).toBe(true);
  });

  it('rejects a non-object and a non-array', () => {
    expect(checkWire(WIRE_LEAD, null)).toHaveLength(1);
    expect(checkWireList(WIRE_LEAD, { data: [] })).toHaveLength(1);
  });
});
