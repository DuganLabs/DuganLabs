import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import {
  MOCK_NOTICE,
  bookingLeadPayloadSchema,
  findContractorsInputSchema,
  findContractorsOutputSchema,
  startQuoteInputSchema,
  startQuoteOutputSchema,
  requestBookingInputSchema,
  requestBookingOutputSchema,
  type FindContractorsOutput,
  type StartQuoteOutput,
  type RequestBookingInput,
  type RequestBookingOutput,
  type BookingLeadPayload,
  type GrantField,
  type ShareableCustomer,
} from './contracts.js';
import type { DiscoveryProvider } from './provider.js';
import { MockProvider } from './mock-provider.js';
import { TelemetrySink } from './telemetry.js';

/**
 * server.ts — composition root and protocol surface.
 *
 * Layers, outside in:
 *  1. Safety gate: the app refuses to boot unless the data mode is
 *     explicitly "mock". There is no real provider yet, and a server that
 *     silently served fixtures as if they were the directory would be a
 *     fabrication machine. When the real provider passes the contract
 *     suite, this gate is where "live" gets allowed — deliberately, in code.
 *  2. Fetch handler: stateful sessions over the SDK's Web Standard
 *     streamable-HTTP transport, so the same handler can deploy to a
 *     Cloudflare Worker unchanged. src/index.ts is only a Node adapter.
 *  3. Tools: thin adapters between contracts.ts schemas and the
 *     DiscoveryProvider. The one piece of real logic here is the booking
 *     grant enforcement (buildLeadPayload) — it runs before any provider
 *     sees a payload.
 */

const SERVER_NAME = 'greenput-discovery';
const SERVER_VERSION = '0.1.0';

const SERVER_INSTRUCTIONS =
  'GreenPut connects customers with verified trade contractors. ' +
  'GreenPut charges contractors one price per delivered lead — booked ' +
  'jobs, not bought leads. A customer\u2019s price exists only inside ' +
  'a quote on a GreenPut pricing engine: start_quote opens one with no ' +
  'price, and the engine\u2019s qualification questions take it to one ' +
  'exact number \u2014 the customer books at that number. Sharing a customer\u2019s data ' +
  'with a contractor requires that customer\u2019s explicit grant, scoped ' +
  'per provider and per field. GreenPut is not affiliated with or ' +
  'endorsed by Tesla, Inc.; certifications listed for a contractor are ' +
  'that contractor\u2019s own credentials.';

export type Env = Record<string, string | undefined>;

/** Boot gate. Returns the data mode on success; throws otherwise. */
export function assertDataModeGate(env: Env): 'mock' {
  const mode = env.GREENPUT_MCP_DATA_MODE;
  if (mode !== 'mock') {
    throw new Error(
      'Refusing to boot: GREENPUT_MCP_DATA_MODE must be set to "mock". ' +
        'No real DiscoveryProvider exists yet, and this server must never ' +
        'serve fixture data under any other label. ' +
        `(got: ${mode === undefined ? 'unset' : JSON.stringify(mode)})`,
    );
  }
  return mode;
}

/** MCP client names are free text ("Claude Desktop", "ChatGPT"). The lead
 * source tag needs a stable token: lowercase, collapse anything that is
 * not [a-z0-9._-] to "-", fall back to "unknown". */
export function sanitizeClientName(raw: string | undefined): string {
  if (!raw) return 'unknown';
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned : 'unknown';
}

/** Keep exactly the customer fields the grant names — a field the caller
 * supplied but the customer did not grant is dropped here and never
 * reaches the sink. */
function filterCustomerToGrant(
  customer: ShareableCustomer,
  fields: GrantField[],
): ShareableCustomer {
  const allowed = new Set<GrantField>(fields);
  const out: ShareableCustomer = {};
  if (allowed.has('name') && customer.name !== undefined) {
    out.name = customer.name;
  }
  if (allowed.has('phone') && customer.phone !== undefined) {
    out.phone = customer.phone;
  }
  if (allowed.has('email') && customer.email !== undefined) {
    out.email = customer.email;
  }
  if (
    allowed.has('service_address') &&
    customer.service_address !== undefined
  ) {
    out.service_address = customer.service_address;
  }
  if (allowed.has('job_details') && customer.job_details !== undefined) {
    out.job_details = customer.job_details;
  }
  if (allowed.has('photos') && customer.photos !== undefined) {
    out.photos = customer.photos;
  }
  return out;
}

/**
 * Build the sink payload for a booking, enforcing the grant:
 * - the schema has already refused a missing/empty/contact-less grant;
 * - the customer is filtered to exactly the granted fields;
 * - if, after filtering, no contact path actually remains (the grant
 *   named phone but no phone was supplied), that is still a hard stop.
 * The result is parsed against bookingLeadPayloadSchema, whose refine
 * re-asserts the subset rule. A payload that fails never reaches a provider.
 */
export function buildLeadPayload(
  input: RequestBookingInput,
  clientName: string,
  now: Date = new Date(),
): BookingLeadPayload {
  const customer = filterCustomerToGrant(input.customer, input.grant.fields);
  if (customer.phone === undefined && customer.email === undefined) {
    throw new Error(
      'The grant names a contact path, but no granted phone or email was ' +
        'actually provided. Nothing was recorded.',
    );
  }
  return bookingLeadPayloadSchema.parse({
    source: `llm-app/${sanitizeClientName(clientName)}`,
    shop_id: input.shop_id,
    service: input.service,
    customer,
    grant: input.grant,
    reroute_allowed: input.grant.allow_network_reroute,
    received_at: now.toISOString(),
  });
}

export interface ServerDeps {
  provider: DiscoveryProvider;
  telemetry: TelemetrySink;
}

function noticeFor(provider: DiscoveryProvider): string {
  return provider.dataMode === 'mock' ? MOCK_NOTICE : '';
}

export function createGreenputServer(deps: ServerDeps): McpServer {
  const { provider, telemetry } = deps;
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  // The client name arrives with the initialize handshake on this session's
  // underlying Server. Read it lazily, per call, never cached across sessions.
  const clientName = (): string =>
    sanitizeClientName(server.server.getClientVersion()?.name);

  server.registerTool(
    'find_contractors',
    {
      title: 'Find Contractors',
      description:
        'Find verified trade contractors for a service near a city or ZIP. ' +
        'Returns only verified shops, ordered by fit. If no verified shop ' +
        'covers the area, the result is empty and the coverage note says ' +
        'so — results are never padded with unverified businesses.',
      inputSchema: findContractorsInputSchema,
      outputSchema: findContractorsOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const data = await provider.findContractors(args);
      const output: FindContractorsOutput = {
        data_mode: provider.dataMode,
        notice: noticeFor(provider),
        results: data.results,
        coverage_note: data.coverageNote,
      };
      telemetry.record({
        tool: 'find_contractors',
        client: clientName(),
        query_shape: {
          service: args.service,
          location_kind: /^\d{5}/.test(args.location.trim()) ? 'zip' : 'city',
          has_certification: args.certification !== undefined,
        },
        zero_result: data.results.length === 0,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    'start_quote',
    {
      title: 'Start Quote',
      description:
        'Open a quote for a service in an area on the shop\u2019s pricing ' +
        'engine. Returns no price: the price exists only inside the quote, ' +
        'and the engine\u2019s qualification questions take it to one ' +
        'exact number the customer books at.',
      inputSchema: startQuoteInputSchema,
      outputSchema: startQuoteOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const data = await provider.startQuote(args);
      const output: StartQuoteOutput = {
        data_mode: provider.dataMode,
        notice: noticeFor(provider),
        service: args.service,
        state: 'awaiting_answers',
        price: null,
        label:
          'no price until the qualification questions are answered — then one exact quote',
        basis: data.basis,
        source_url: data.sourceUrl,
      };
      telemetry.record({
        tool: 'start_quote',
        client: clientName(),
        query_shape: {
          service: args.service,
          location_kind: /^\d{5}/.test(args.location.trim()) ? 'zip' : 'city',
          has_params: args.params !== undefined,
        },
        zero_result: false,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    'request_booking',
    {
      title: 'Request Booking',
      description:
        'Request a booking with ONE shop. This shares customer data with ' +
        'that shop, so it requires the customer\u2019s explicit grant naming ' +
        'exactly which fields may be shared, for the purpose ' +
        'quote-and-schedule. No grant, an empty grant, or a grant with no ' +
        'contact path (phone or email) errors and records nothing. Only ' +
        'the granted fields are recorded. The response carries a sharing ' +
        'receipt: what was shared, with whom, under what grant. When the ' +
        'shop is enrolled in schedule management and the request falls ' +
        'inside its configured scope, the response confirms a real booked ' +
        'slot; otherwise no booking is promised in chat and the shop ' +
        'confirms through GreenPut\u2019s normal flow.',
      inputSchema: requestBookingInputSchema,
      outputSchema: requestBookingOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const client = clientName();
      // Throws on any grant problem — before the provider is touched, so
      // the sink stays exactly as it was.
      const payload = buildLeadPayload(args, client);
      const receipt = await provider.submitBooking(payload);
      const output: RequestBookingOutput = {
        data_mode: provider.dataMode,
        notice: noticeFor(provider),
        confirmation_ref: receipt.confirmationRef,
        status: receipt.confirmedSlot
          ? 'confirmed — booked into the shop’s schedule'
          : 'received — the shop confirms through the normal flow',
        ...(receipt.confirmedSlot
          ? {
              confirmed_slot: {
                start: receipt.confirmedSlot.start,
                end: receipt.confirmedSlot.end,
                timezone: receipt.confirmedSlot.timezone,
              },
            }
          : {}),
        sharing_receipt: {
          grant_id: receipt.grantId,
          shared_with: {
            shop_id: payload.shop_id,
            business_name: receipt.shopBusinessName,
          },
          fields: [...payload.grant.fields],
          purpose: payload.grant.purpose,
          shared_at: payload.received_at,
        },
      };
      telemetry.record({
        tool: 'request_booking',
        client,
        query_shape: {
          service: args.service,
          granted_fields: [...args.grant.fields].sort(),
          reroute_allowed: args.grant.allow_network_reroute,
        },
        zero_result: false,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      };
    },
  );

  return server;
}

// ---------------------------------------------------------------------------
// App composition + fetch handler
// ---------------------------------------------------------------------------

export interface GreenputApp {
  provider: DiscoveryProvider;
  telemetry: TelemetrySink;
  /** Web Standard fetch handler — deployable to a Worker as-is. */
  handleRequest: (req: Request) => Promise<Response>;
  close: () => Promise<void>;
}

function jsonRpcError(status: number, code: number, message: string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code, message },
      id: null,
    }),
    {
      status,
      headers: { 'content-type': 'application/json' },
    },
  );
}

export function createApp(
  env: Env,
  overrides: { provider?: DiscoveryProvider } = {},
): GreenputApp {
  assertDataModeGate(env);
  const provider =
    overrides.provider ?? new MockProvider(env.GREENPUT_MCP_BOOKING_SINK_FILE);
  const telemetry = new TelemetrySink(env.GREENPUT_MCP_TELEMETRY_FILE);
  const deps: ServerDeps = { provider, telemetry };

  const sessions = new Map<
    string,
    {
      server: McpServer;
      transport: WebStandardStreamableHTTPServerTransport;
    }
  >();

  async function handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // A human poking the root gets a banner, not a protocol error.
    if (req.method === 'GET' && url.pathname === '/') {
      return new Response(
        `${SERVER_NAME} ${SERVER_VERSION} — MCP discovery server ` +
          `(data_mode: ${provider.dataMode}). MCP endpoint: /mcp\n`,
        { status: 200, headers: { 'content-type': 'text/plain' } },
      );
    }

    if (req.method === 'POST') {
      let body: unknown;
      try {
        body = JSON.parse(await req.text());
      } catch {
        return jsonRpcError(
          400,
          -32700,
          'Parse error: body is not valid JSON.',
        );
      }

      if (isInitializeRequest(body)) {
        const server = createGreenputServer(deps);
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          // Plain JSON responses instead of SSE streams: this prototype is
          // request/response only, and JSON keeps the transport testable
          // in-process. Revisit before any directory submission.
          enableJsonResponse: true,
          onsessioninitialized: (sessionId) => {
            sessions.set(sessionId, { server, transport });
          },
          onsessionclosed: (sessionId) => {
            sessions.delete(sessionId);
          },
        });
        await server.connect(transport);
        return transport.handleRequest(req, { parsedBody: body });
      }

      const sessionId = req.headers.get('mcp-session-id') ?? undefined;
      const entry = sessionId ? sessions.get(sessionId) : undefined;
      if (!entry) {
        return jsonRpcError(
          sessionId ? 404 : 400,
          -32000,
          sessionId
            ? 'Session not found. Send a new initialize request.'
            : 'Missing mcp-session-id header. Send an initialize request first.',
        );
      }
      return entry.transport.handleRequest(req, { parsedBody: body });
    }

    if (req.method === 'GET' || req.method === 'DELETE') {
      const sessionId = req.headers.get('mcp-session-id') ?? undefined;
      const entry = sessionId ? sessions.get(sessionId) : undefined;
      if (!entry) {
        return jsonRpcError(404, -32000, 'Session not found.');
      }
      return entry.transport.handleRequest(req);
    }

    return new Response('Method not allowed', { status: 405 });
  }

  async function close(): Promise<void> {
    for (const { transport } of sessions.values()) {
      await transport.close();
    }
    sessions.clear();
  }

  return { provider, telemetry, handleRequest, close };
}
