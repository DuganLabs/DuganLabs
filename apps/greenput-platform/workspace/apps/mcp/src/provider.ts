import type {
  BookingLeadPayload,
  ContractorResult,
  DataMode,
  FindContractorsInput,
  StartQuoteInput,
} from './contracts.js';

/**
 * DiscoveryProvider — the seam of the pact.
 *
 * The MCP tools (server.ts) speak only in contracts.ts schemas. Everything
 * behind this interface is data access. MockProvider implements it today;
 * the real provider (directory + pricing engines) implements it later and
 * must pass the exact same contract suite (test/contracts.test.ts) before
 * it can replace the mock. Server.ts refuses to boot on anything but the
 * mock until that day.
 */
export interface FindContractorsData {
  results: ContractorResult[];
  coverageNote: string;
}

/** An opened quote. Carries no price: the price exists only inside the
 * quote, once the engine's questions are answered. */
export interface QuoteSessionData {
  /** Name of the pricing engine the quote runs on. */
  basis: string;
  /** The owned GreenPut page the answer comes from. */
  sourceUrl: string;
}

export interface BookingReceiptData {
  confirmationRef: string;
  grantId: string;
  /** Resolved by the provider — it owns the shop records. */
  shopBusinessName: string;
  /** Set when the booking landed inside the shop's configured
   * auto-booking scope and a slot was actually booked (schedule-aware
   * delivery). Absent = the request-flow fallback. */
  confirmedSlot?: { start: string; end: string; timezone: string };
}

export interface DiscoveryProvider {
  readonly dataMode: DataMode;
  findContractors(input: FindContractorsInput): Promise<FindContractorsData>;
  startQuote(input: StartQuoteInput): Promise<QuoteSessionData>;
  /**
   * Persist one lead-intake payload to the booking sink. The payload has
   * already been grant-checked and field-filtered by the server layer
   * (buildLeadPayload in server.ts) and validates against
   * bookingLeadPayloadSchema, which re-asserts that no ungranted field is
   * present. Providers never widen what a payload carries.
   */
  submitBooking(payload: BookingLeadPayload): Promise<BookingReceiptData>;
}
