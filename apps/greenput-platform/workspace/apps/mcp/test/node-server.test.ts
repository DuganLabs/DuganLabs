import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { MockProvider } from '../src/mock-provider.js';
import { createApp, type GreenputApp } from '../src/server.js';
import { startNodeServer } from '../src/index.js';

/**
 * Socket E2E — the real SDK Client against the real node entry on a real
 * port. Proves the node adapter, the transport, and the client-name flow
 * (initialize clientInfo -> llm-app/<client> source tag) end to end,
 * exactly as an LLM host would exercise them.
 */
describe('node entry + SDK client', () => {
  let app: GreenputApp;
  let server: Server;
  let client: Client;
  let port = 0;

  beforeAll(async () => {
    app = createApp({ GREENPUT_MCP_DATA_MODE: 'mock' });
    server = await startNodeServer(app, 0);
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('node server did not bind a port');
    }
    port = address.port;
    client = new Client({ name: 'contract-test-client', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${port}/mcp`),
      ),
    );
  }, 20000);

  afterAll(async () => {
    await client.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app.close();
  });

  it('lists exactly the three tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'find_contractors',
      'request_booking',
      'start_quote',
    ]);
  });

  it('calls the read tools and gets mock-labeled structured content', async () => {
    const found = await client.callTool({
      name: 'find_contractors',
      arguments: { service: 'ev-charger-install', location: 'Irvine' },
    });
    const foundOut = (found as { structuredContent?: Record<string, any> })
      .structuredContent;
    expect(foundOut?.data_mode).toBe('mock');
    expect(
      (foundOut?.results as unknown[] | undefined)?.length,
    ).toBeGreaterThan(0);

    const price = await client.callTool({
      name: 'start_quote',
      arguments: { service: 'surge-protection', location: '92618' },
    });
    const priceOut = (price as { structuredContent?: Record<string, any> })
      .structuredContent;
    expect(priceOut?.label).toBe(
      'no price until the qualification questions are answered — then one exact quote',
    );
    expect(priceOut?.price).toBeNull();
    expect(priceOut?.data_mode).toBe('mock');
  });

  it('books under a grant — sink tagged llm-app/contract-test-client', async () => {
    const provider = app.provider as MockProvider;
    const result = await client.callTool({
      name: 'request_booking',
      arguments: {
        shop_id: 'mock-pacific-fictional-electric',
        service: 'ev-charger-install',
        customer: {
          name: 'Jamie Example',
          email: 'jamie@example.test',
          service_address: '1 Example Way, Irvine, CA',
        },
        grant: {
          fields: ['name', 'email', 'service_address'],
          purpose: 'quote-and-schedule',
          allow_network_reroute: true,
          granted_at: '2026-10-15T12:00:00.000Z',
        },
      },
    });
    const out = (result as { structuredContent?: Record<string, any> })
      .structuredContent;
    expect(out?.data_mode).toBe('mock');
    expect(out?.sharing_receipt?.fields).toEqual([
      'name',
      'email',
      'service_address',
    ]);
    expect(provider.bookings).toHaveLength(1);
    expect(provider.bookings[0]?.source).toBe('llm-app/contract-test-client');
    expect(provider.bookings[0]?.reroute_allowed).toBe(true);
  });

  it('rejects a grant-less booking and the sink stays unchanged', async () => {
    const provider = app.provider as MockProvider;
    const result = await client.callTool({
      name: 'request_booking',
      arguments: {
        shop_id: 'mock-pacific-fictional-electric',
        service: 'ev-charger-install',
        customer: { name: 'Jamie Example', email: 'jamie@example.test' },
      },
    });
    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(provider.bookings).toHaveLength(1);
  });
});
