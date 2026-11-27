import { describe, expect, it } from 'vitest';
import {
  findContractorsOutputSchema,
  startQuoteOutputSchema,
  requestBookingOutputSchema,
} from '../src/contracts.js';
import { MockProvider } from '../src/mock-provider.js';
import {
  assertDataModeGate,
  createApp,
  sanitizeClientName,
  type GreenputApp,
} from '../src/server.js';

/**
 * Protocol E2E — drives the real streamable-HTTP MCP transport in-process
 * through the app's fetch handler: initialize handshake, tools/list,
 * tools/call. Nothing is stubbed; the JSON-RPC on the wire is what a host
 * (ChatGPT, Claude) would see.
 */

const MOCK_ENV = { GREENPUT_MCP_DATA_MODE: 'mock' };

interface RpcResponse {
  status: number;
  headers: Headers;
  json: {
    result?: Record<string, any>;
    error?: { code: number; message: string };
  } | null;
}

async function rpc(
  app: GreenputApp,
  payload: Record<string, unknown>,
  sessionId?: string,
): Promise<RpcResponse> {
  const res = await app.handleRequest(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      body: JSON.stringify(payload),
    }),
  );
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    json: text ? (JSON.parse(text) as RpcResponse['json']) : null,
  };
}

async function initSession(app: GreenputApp): Promise<string> {
  const init = await rpc(app, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'contract-test-client', version: '0.0.0' },
    },
  });
  expect(init.status).toBe(200);
  expect(init.json?.result?.serverInfo?.name).toBe('greenput-discovery');
  const sessionId = init.headers.get('mcp-session-id');
  expect(sessionId).toBeTruthy();
  const ready = await rpc(
    app,
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    sessionId ?? undefined,
  );
  expect(ready.status).toBe(202);
  return sessionId as string;
}

let callId = 100;
async function callTool(
  app: GreenputApp,
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, any>> {
  const res = await rpc(
    app,
    {
      jsonrpc: '2.0',
      id: ++callId,
      method: 'tools/call',
      params: { name, arguments: args },
    },
    sessionId,
  );
  expect(res.status).toBe(200);
  return (res.json?.result ?? {}) as Record<string, any>;
}

describe('safety gate', () => {
  it('refuses to boot without GREENPUT_MCP_DATA_MODE=mock', () => {
    expect(() => assertDataModeGate({})).toThrow(/GREENPUT_MCP_DATA_MODE/);
    expect(() =>
      assertDataModeGate({ GREENPUT_MCP_DATA_MODE: 'live' }),
    ).toThrow(/Refusing to boot/);
    expect(() => createApp({})).toThrow(/GREENPUT_MCP_DATA_MODE/);
    expect(assertDataModeGate(MOCK_ENV)).toBe('mock');
  });

  it('sanitizes client names for the lead source tag', () => {
    expect(sanitizeClientName('contract-test-client')).toBe(
      'contract-test-client',
    );
    expect(sanitizeClientName('Claude Desktop')).toBe('claude-desktop');
    expect(sanitizeClientName(undefined)).toBe('unknown');
    expect(sanitizeClientName('!!!')).toBe('unknown');
  });
});

describe('request_booking schedule scope (10b)', () => {
  it('an unenrolled shop returns the request-flow status and no slot', async () => {
    const app = createApp(MOCK_ENV);
    const sessionId = await initSession(app);
    const booked = await callTool(app, sessionId, 'request_booking', {
      shop_id: 'mock-pacific-fictional-electric',
      service: 'ev-charger-install',
      customer: { name: 'Jamie Example', phone: '+1-555-0100' },
      grant: {
        fields: ['name', 'phone'],
        purpose: 'quote-and-schedule',
        allow_network_reroute: false,
        granted_at: '2026-10-15T12:00:00.000Z',
      },
    });
    expect(booked.isError).toBeFalsy();
    const out = requestBookingOutputSchema.parse(booked.structuredContent);
    expect(out.status).toBe(
      'received — the shop confirms through the normal flow',
    );
    expect(out.confirmed_slot).toBeUndefined();
  });
});

describe('protocol E2E (fetch handler)', () => {
  it('completes the full tool surface over real JSON-RPC', async () => {
    const app = createApp(MOCK_ENV);
    const provider = app.provider as MockProvider;
    const sessionId = await initSession(app);

    // tools/list: exactly three tools, honest annotations.
    const list = await rpc(
      app,
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      sessionId,
    );
    const tools = (list.json?.result?.tools ?? []) as Array<
      Record<string, any>
    >;
    expect(tools.map((t) => t.name).sort()).toEqual([
      'find_contractors',
      'request_booking',
      'start_quote',
    ]);
    const byName = new Map(tools.map((t) => [t.name as string, t]));
    expect(byName.get('find_contractors')?.annotations?.readOnlyHint).toBe(
      true,
    );
    expect(byName.get('start_quote')?.annotations?.readOnlyHint).toBe(true);
    const booking = byName.get('request_booking');
    expect(booking?.annotations?.readOnlyHint).toBe(false);
    expect(booking?.annotations?.destructiveHint).toBe(false);
    expect(booking?.annotations?.idempotentHint).toBe(false);

    // find_contractors — covered area.
    const found = await callTool(app, sessionId, 'find_contractors', {
      service: 'ev-charger-install',
      location: 'Irvine',
    });
    expect(found.isError).toBeFalsy();
    const foundOut = findContractorsOutputSchema.parse(found.structuredContent);
    expect(foundOut.data_mode).toBe('mock');
    expect(foundOut.notice).toContain('Mock data');
    expect(foundOut.results.length).toBeGreaterThan(0);

    // find_contractors — uncovered area, honest empty state.
    const empty = await callTool(app, sessionId, 'find_contractors', {
      service: 'ev-charger-install',
      location: 'Denver',
    });
    const emptyOut = findContractorsOutputSchema.parse(empty.structuredContent);
    expect(emptyOut.data_mode).toBe('mock');
    expect(emptyOut.results).toEqual([]);
    expect(emptyOut.coverage_note).toContain('Orange County');

    // start_quote — label + data_mode, and no price at open.
    const price = await callTool(app, sessionId, 'start_quote', {
      service: 'panel-upgrade',
      location: 'Irvine',
    });
    const priceOut = startQuoteOutputSchema.parse(price.structuredContent);
    expect(priceOut.data_mode).toBe('mock');
    expect(priceOut.label).toBe(
      'no price until the qualification questions are answered — then one exact quote',
    );
    expect(priceOut.price).toBeNull();
    expect(priceOut.state).toBe('awaiting_answers');

    // request_booking — happy path under a grant.
    const grant = {
      fields: ['name', 'phone'],
      purpose: 'quote-and-schedule',
      allow_network_reroute: false,
      granted_at: '2026-10-15T12:00:00.000Z',
    };
    const booked = await callTool(app, sessionId, 'request_booking', {
      shop_id: 'mock-suntest-electric',
      service: 'ev-charger-install',
      customer: {
        name: 'Jamie Example',
        phone: '+1-555-0100',
        email: 'jamie@example.test',
        job_details: 'Garage charger.',
      },
      grant,
    });
    expect(booked.isError).toBeFalsy();
    const bookedOut = requestBookingOutputSchema.parse(
      booked.structuredContent,
    );
    expect(bookedOut.data_mode).toBe('mock');
    expect(bookedOut.confirmation_ref).toMatch(/^mock-conf-/);
    // (10b) SunTest is enrolled in schedule management for this service,
    // so the booking CONFIRMS a slot instead of taking the request flow.
    expect(bookedOut.status).toBe(
      'confirmed — booked into the shop’s schedule',
    );
    expect(bookedOut.confirmed_slot?.timezone).toBe('America/Los_Angeles');
    expect(bookedOut.confirmed_slot?.start).toBeTruthy();
    // (d) the receipt's fields equal the grant's fields exactly.
    expect(bookedOut.sharing_receipt.fields).toEqual(grant.fields);
    expect(bookedOut.sharing_receipt.purpose).toBe('quote-and-schedule');
    expect(bookedOut.sharing_receipt.shared_with).toEqual({
      shop_id: 'mock-suntest-electric',
      business_name: 'MOCK — SunTest Electric Co.',
    });

    // The sink holds exactly one payload, tagged with the client from the
    // initialize handshake, carrying only the granted fields.
    expect(provider.bookings).toHaveLength(1);
    const payload = provider.bookings[0];
    expect(payload?.source).toBe('llm-app/contract-test-client');
    expect(payload?.customer).toEqual({
      name: 'Jamie Example',
      phone: '+1-555-0100',
    });
    expect(payload?.grant).toEqual(grant);
    expect(payload?.reroute_allowed).toBe(false);

    // request_booking — no grant: error, sink unchanged.
    const noGrant = await callTool(app, sessionId, 'request_booking', {
      shop_id: 'mock-suntest-electric',
      service: 'ev-charger-install',
      customer: { name: 'Jamie Example', phone: '+1-555-0100' },
    });
    expect(noGrant.isError).toBe(true);
    expect(provider.bookings).toHaveLength(1);

    // request_booking — grant without a contact path: error, sink unchanged.
    const noContact = await callTool(app, sessionId, 'request_booking', {
      shop_id: 'mock-suntest-electric',
      service: 'ev-charger-install',
      customer: { name: 'Jamie Example', phone: '+1-555-0100' },
      grant: { ...grant, fields: ['name', 'job_details'] },
    });
    expect(noContact.isError).toBe(true);
    expect(provider.bookings).toHaveLength(1);

    // Telemetry saw the calls, tagged with the handshake client; the
    // Denver lookup is recorded as a zero result.
    const records = app.telemetry.records;
    expect(records.length).toBeGreaterThanOrEqual(4);
    expect(records.every((r) => r.client === 'contract-test-client')).toBe(
      true,
    );
    expect(
      records.some((r) => r.tool === 'find_contractors' && r.zero_result),
    ).toBe(true);
    expect(
      records.some((r) => r.tool === 'request_booking' && !r.zero_result),
    ).toBe(true);

    await app.close();
  });
});
