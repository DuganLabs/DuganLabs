import { z } from 'zod';

/**
 * contracts.ts — THE CONTRACT for the GreenPut discovery MCP server.
 *
 * Every tool input/output is a zod schema in this file. The JSON Schemas
 * under contracts/ are generated from these (scripts/generate-contracts.ts)
 * and a test fails if they drift. Providers (mock today, real later) are
 * swappable precisely because this file is not: a provider that cannot
 * satisfy these schemas does not ship.
 *
 * Model facts baked into the contract (GEO plan v3):
 * - GreenPut charges one price per delivered lead — booked jobs, not bought
 *   leads. A homeowner price exists only inside a quote: start_quote opens
 *   one and returns no price; the engine's qualification questions take it
 *   to one exact number the customer books at. The quote tool's label
 *   states exactly that. No tool returns a dollar range.
 * - Only verified contractors are ever returned. An uncovered area is an
 *   honest empty result, never a padded list.
 * - Connecting an LLM app is not consent to share personal data. The one
 *   sharing moment in v1 (request_booking) requires an explicit grant:
 *   per provider, per field, purpose-bound, and receipted.
 * - GreenPut is not affiliated with or endorsed by Tesla, Inc.
 *   Certifications are contractor attributes, not endorsements.
 */

/** The electrical services seeded in GreenPut's pricing engines (FSMs). */
export const SERVICE_IDS = [
  'ev-charger-install',
  'panel-upgrade',
  'circuit-outlet',
  'troubleshooting',
  'surge-protection',
] as const;

export const serviceIdSchema = z.enum(SERVICE_IDS);
export type ServiceId = z.infer<typeof serviceIdSchema>;

/** Where the data behind a response came from. There is no live provider
 * yet, so 'mock' is the only value the server will currently emit — the
 * safety gate in server.ts refuses to boot in any other mode. */
export const dataModeSchema = z.enum(['mock', 'live']);
export type DataMode = z.infer<typeof dataModeSchema>;

/** Carried on every mock-mode tool response. */
export const MOCK_NOTICE =
  'Mock data — contract testing only. Not for directory submission.';

// ---------------------------------------------------------------------------
// find_contractors
// ---------------------------------------------------------------------------

export const findContractorsInputSchema = z.object({
  service: serviceIdSchema.describe(
    'The service the customer needs. One of the pricing-engine services.',
  ),
  location: z
    .string()
    .min(1)
    .describe('City name (e.g. "Irvine") or 5-digit ZIP code.'),
  certification: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Optional certification filter, e.g. "tesla-certified". Only shops ' +
        'holding the certification are returned.',
    ),
});
export type FindContractorsInput = z.infer<typeof findContractorsInputSchema>;

export const contractorResultSchema = z.object({
  business_name: z.string().min(1),
  services: z.array(serviceIdSchema),
  service_area: z.string().min(1),
  certifications: z.array(z.string()),
  profile_url: z.url(),
});
export type ContractorResult = z.infer<typeof contractorResultSchema>;

export const findContractorsOutputSchema = z.object({
  data_mode: dataModeSchema,
  notice: z.string(),
  results: z.array(contractorResultSchema),
  coverage_note: z
    .string()
    .describe(
      'States the covered area. On an empty result, names the nearest ' +
        'covered area plainly instead of implying coverage that is not there.',
    ),
});
export type FindContractorsOutput = z.infer<typeof findContractorsOutputSchema>;

// ---------------------------------------------------------------------------
// start_quote
// ---------------------------------------------------------------------------

export const startQuoteInputSchema = z.object({
  service: serviceIdSchema,
  location: z.string().min(1).describe('City name or 5-digit ZIP code.'),
  params: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Optional pricing-engine inputs (e.g. panel amperage, charger ' +
        'distance). Kept loose until the real engines define their inputs.',
    ),
});
export type StartQuoteInput = z.infer<typeof startQuoteInputSchema>;

export const startQuoteOutputSchema = z.object({
  data_mode: dataModeSchema,
  notice: z.string(),
  service: serviceIdSchema,
  /** A quote opens with no price. The engine's qualification questions
   * (panel photo, charger location) happen inside the quote; the price
   * exists only there, and the customer books at one exact number. */
  state: z.literal('awaiting_answers'),
  /** Always null at open — there is no price before the questions. */
  price: z.null(),
  /** Part of the contract, not presentation copy. */
  label: z.literal(
    'no price until the qualification questions are answered — then one exact quote',
  ),
  basis: z.string().describe('Name of the pricing engine the quote runs on.'),
  source_url: z
    .url()
    .describe('The owned GreenPut page this answer comes from.'),
});
export type StartQuoteOutput = z.infer<typeof startQuoteOutputSchema>;

// ---------------------------------------------------------------------------
// request_booking — the only sharing moment in v1
// ---------------------------------------------------------------------------

/**
 * Sharing a person's data with a contractor gets OAuth/GitHub-App-level
 * transparency: connecting an LLM app is NOT consent to share. Sharing is a
 * separate, explicit grant — scoped to ONE provider (the shop_id in the
 * request), per field, bound to a stated purpose, and receipted in the
 * response. The way a GitHub App install makes you pick the org and the
 * repos, a booking grant makes the customer pick the shop and the fields.
 */
export const GRANT_FIELDS = [
  'name',
  'phone',
  'email',
  'service_address',
  'job_details',
  'photos',
] as const;

export const grantFieldSchema = z.enum(GRANT_FIELDS);
export type GrantField = z.infer<typeof grantFieldSchema>;

/** The fields of a customer that could ever be shared. All optional at the
 * schema level — the grant decides which of them actually move. A field
 * that is present in the input but absent from grant.fields is dropped
 * before anything is recorded. */
export const shareableCustomerSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  email: z.string().min(1).optional(),
  service_address: z.string().min(1).optional(),
  job_details: z.string().min(1).optional(),
  photos: z.array(z.string()).optional(),
});
export type ShareableCustomer = z.infer<typeof shareableCustomerSchema>;

export const bookingGrantSchema = z
  .object({
    fields: z
      .array(grantFieldSchema)
      .min(1, 'A grant must name at least one field.')
      .describe(
        'Exactly the customer fields this grant allows GreenPut to share ' +
          'with the one shop named by shop_id. Nothing outside this list moves.',
      ),
    purpose: z
      .literal('quote-and-schedule')
      .describe('The only purpose a v1 grant can be issued for.'),
    allow_network_reroute: z
      .boolean()
      .describe(
        'May GreenPut re-share this lead with a different shop in the ' +
          'network pool if the named shop cannot take it? A reroute is a ' +
          're-sharing event and is forbidden unless this is true.',
      ),
    granted_at: z.iso.datetime().describe('When the customer granted this.'),
  })
  .refine(
    (grant) => grant.fields.includes('phone') || grant.fields.includes('email'),
    {
      message:
        'A grant must include a contact path: at least one of phone or email.',
    },
  );
export type BookingGrant = z.infer<typeof bookingGrantSchema>;

export const requestBookingInputSchema = z.object({
  shop_id: z
    .string()
    .min(1)
    .describe(
      'The one contractor this booking — and its grant — is for. In v1 ' +
        'this is the shop slug from its find_contractors profile_url.',
    ),
  service: serviceIdSchema,
  customer: shareableCustomerSchema.describe(
    'Customer details as provided. Only the fields named in grant.fields ' +
      'are recorded or shared; everything else is dropped.',
  ),
  grant: bookingGrantSchema.describe(
    'The customer\u2019s explicit, per-provider, per-field sharing grant. ' +
      'No grant, an empty grant, or a grant with no contact path is a hard ' +
      'stop: the call errors and nothing is recorded.',
  ),
});
export type RequestBookingInput = z.infer<typeof requestBookingInputSchema>;

/**
 * The lead-intake payload a granted booking writes to the booking sink.
 * Shaped like a form submission because that is what it is: the request
 * enters GreenPut's normal lead pipeline, source-tagged with the calling
 * LLM client (llm-app/<client>) so the delivered-lead meter and outcome
 * tracking apply unchanged. The grant is recorded verbatim alongside the
 * lead — it is the standing evidence of what sharing was authorized.
 */
export const bookingLeadPayloadSchema = z
  .object({
    source: z.string().regex(/^llm-app\//),
    shop_id: z.string().min(1),
    service: serviceIdSchema,
    /** Only granted fields. Enforced again by the refine below. */
    customer: shareableCustomerSchema,
    grant: bookingGrantSchema,
    /** Copied from grant.allow_network_reroute. A reroute to another shop
     * is a re-sharing event and is forbidden unless this is true. */
    reroute_allowed: z.boolean(),
    received_at: z.iso.datetime(),
  })
  .refine(
    (payload) =>
      Object.keys(payload.customer).every((key) =>
        payload.grant.fields.includes(key as GrantField),
      ),
    {
      message:
        'Payload customer carries a field the grant did not authorize. ' +
        'This payload must never be written.',
    },
  );
export type BookingLeadPayload = z.infer<typeof bookingLeadPayloadSchema>;

/** The transparency artifact returned to the caller: what was shared, with
 * whom, under what grant. fields echoes the grant exactly. */
export const sharingReceiptSchema = z.object({
  grant_id: z.string().min(1),
  shared_with: z.object({
    shop_id: z.string().min(1),
    business_name: z.string().min(1),
  }),
  fields: z.array(grantFieldSchema),
  purpose: z.literal('quote-and-schedule'),
  shared_at: z.iso.datetime(),
});
export type SharingReceipt = z.infer<typeof sharingReceiptSchema>;

/** A slot the delivery engine confirmed inside the shop's configured
 * auto-booking scope (schedule-aware delivery, plan item 10b). Present
 * only when status is the confirmed string; absent means the request
 * went to the shop's normal confirm flow. */
export const confirmedSlotSchema = z.object({
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  timezone: z.string().min(1),
});
export type ConfirmedSlot = z.infer<typeof confirmedSlotSchema>;

export const requestBookingOutputSchema = z.object({
  data_mode: dataModeSchema,
  notice: z.string(),
  confirmation_ref: z.string().min(1),
  /** Two honest states. CONFIRMED means the booking landed inside the
   * shop's configured auto-booking scope (their enrolled windows,
   * services, and team) and a real slot was booked — confirmed_slot
   * carries it. RECEIVED means it fell outside that scope: no booking
   * is promised inside the chat and the shop confirms through
   * GreenPut's normal flow. */
  status: z.enum([
    'received — the shop confirms through the normal flow',
    'confirmed — booked into the shop’s schedule',
  ]),
  confirmed_slot: confirmedSlotSchema.optional(),
  sharing_receipt: sharingReceiptSchema,
});
export type RequestBookingOutput = z.infer<typeof requestBookingOutputSchema>;

// ---------------------------------------------------------------------------
// JSON Schema export (contracts/*.json)
// ---------------------------------------------------------------------------

/** Every schema that gets a checked-in JSON Schema twin. The test in
 * test/contracts.test.ts regenerates this map and compares it to disk. */
export function buildContractJsonSchemas(): Record<string, unknown> {
  return {
    'find_contractors.input': z.toJSONSchema(findContractorsInputSchema),
    'find_contractors.output': z.toJSONSchema(findContractorsOutputSchema),
    'start_quote.input': z.toJSONSchema(startQuoteInputSchema),
    'start_quote.output': z.toJSONSchema(startQuoteOutputSchema),
    'request_booking.input': z.toJSONSchema(requestBookingInputSchema),
    'request_booking.output': z.toJSONSchema(requestBookingOutputSchema),
    booking_grant: z.toJSONSchema(bookingGrantSchema),
    booking_lead_payload: z.toJSONSchema(bookingLeadPayloadSchema),
    sharing_receipt: z.toJSONSchema(sharingReceiptSchema),
  };
}
