import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { signPayload, dispatchWebhooks } from './dispatcher';
import type { WebhookEventType } from './dispatcher';

describe('webhook dispatcher', () => {
  describe('signPayload', () => {
    it('produces a hex-encoded HMAC-SHA256 signature', async () => {
      const payload = '{"event":"test.ping","data":{}}';
      const secret = 'test-secret-key';
      const sig = await signPayload(payload, secret);

      // HMAC-SHA256 produces 32 bytes = 64 hex chars
      expect(sig).toHaveLength(64);
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces consistent signatures for the same input', async () => {
      const payload = '{"event":"lead.created"}';
      const secret = 'my-secret';
      const sig1 = await signPayload(payload, secret);
      const sig2 = await signPayload(payload, secret);
      expect(sig1).toBe(sig2);
    });

    it('produces different signatures for different secrets', async () => {
      const payload = '{"event":"lead.created"}';
      const sig1 = await signPayload(payload, 'secret-1');
      const sig2 = await signPayload(payload, 'secret-2');
      expect(sig1).not.toBe(sig2);
    });

    it('produces different signatures for different payloads', async () => {
      const secret = 'same-secret';
      const sig1 = await signPayload('{"a":1}', secret);
      const sig2 = await signPayload('{"a":2}', secret);
      expect(sig1).not.toBe(sig2);
    });

    it('handles empty payload', async () => {
      const sig = await signPayload('', 'secret');
      expect(sig).toHaveLength(64);
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('WebhookEventType', () => {
    it('includes all expected event types', () => {
      const events: WebhookEventType[] = [
        'lead.created',
        'lead.updated',
        'lead.deleted',
        'lead.converted',
        'opportunity.created',
        'opportunity.updated',
        'opportunity.deleted',
        'opportunity.converted',
        'job.created',
        'job.updated',
        'job.deleted',
        'job.status_changed',
        'customer.created',
        'customer.updated',
        'customer.deleted',
        'campaign.created',
        'campaign.updated',
        'campaign.deleted',
        'payment.received',
        'test.ping',
      ];
      expect(events).toHaveLength(20);
    });
  });

  describe('dispatchWebhooks', () => {
    it('exports dispatchWebhooks function', async () => {
      const mod = await import('./dispatcher');
      expect(mod.dispatchWebhooks).toBeDefined();
      expect(typeof mod.dispatchWebhooks).toBe('function');
    });

    it('does nothing when no webhooks match workspace', async () => {
      const mockEnv = {
        DB: {
          prepare: vi.fn().mockReturnValue({
            bind: vi.fn().mockReturnThis(),
            all: vi.fn().mockResolvedValue({ results: [] }),
            run: vi.fn().mockResolvedValue({}),
          }),
        },
      };
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      await dispatchWebhooks(mockEnv as never, 'ws-1', 'lead.created', {
        id: 'l-1',
      });
      expect(fetchMock).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it('does not call fetch when webhook does not subscribe to event', async () => {
      const mockEnv = {
        DB: {
          prepare: vi.fn().mockReturnValue({
            bind: vi.fn().mockReturnThis(),
            all: vi.fn().mockResolvedValue({
              results: [
                {
                  id: 'wh-1',
                  url: 'https://example.com/hook',
                  secret: 'secret',
                  events: JSON.stringify(['job.created']), // does not include lead.created
                },
              ],
            }),
            run: vi.fn().mockResolvedValue({}),
          }),
        },
      };
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      await dispatchWebhooks(mockEnv as never, 'ws-1', 'lead.created', {});
      expect(fetchMock).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it('calls fetch when webhook subscribes to event', async () => {
      const runMock = vi.fn().mockResolvedValue({});
      const mockEnv = {
        DB: {
          prepare: vi.fn().mockReturnValue({
            bind: vi.fn().mockReturnThis(),
            all: vi.fn().mockResolvedValue({
              results: [
                {
                  id: 'wh-1',
                  url: 'https://example.com/hook',
                  secret: 'my-secret',
                  events: JSON.stringify(['lead.created']),
                },
              ],
            }),
            run: runMock,
          }),
        },
      };
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        text: vi.fn().mockResolvedValue('OK'),
      });
      vi.stubGlobal('fetch', fetchMock);

      await dispatchWebhooks(mockEnv as never, 'ws-1', 'lead.created', {
        id: 'l-1',
      });
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock.mock.calls[0][0]).toBe('https://example.com/hook');
      expect(runMock).toHaveBeenCalled(); // delivery record saved

      vi.unstubAllGlobals();
    });

    it('calls fetch when webhook subscribes to wildcard *', async () => {
      const mockEnv = {
        DB: {
          prepare: vi.fn().mockReturnValue({
            bind: vi.fn().mockReturnThis(),
            all: vi.fn().mockResolvedValue({
              results: [
                {
                  id: 'wh-1',
                  url: 'https://example.com/hook',
                  secret: 'my-secret',
                  events: JSON.stringify(['*']),
                },
              ],
            }),
            run: vi.fn().mockResolvedValue({}),
          }),
        },
      };
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        text: vi.fn().mockResolvedValue('OK'),
      });
      vi.stubGlobal('fetch', fetchMock);

      await dispatchWebhooks(mockEnv as never, 'ws-1', 'campaign.created', {
        id: 'c-1',
      });
      expect(fetchMock).toHaveBeenCalledOnce();

      vi.unstubAllGlobals();
    });

    it('adds X-Greenput-Signature header to request', async () => {
      const mockEnv = {
        DB: {
          prepare: vi.fn().mockReturnValue({
            bind: vi.fn().mockReturnThis(),
            all: vi.fn().mockResolvedValue({
              results: [
                {
                  id: 'wh-1',
                  url: 'https://example.com/hook',
                  secret: 'my-secret',
                  events: JSON.stringify(['lead.created']),
                },
              ],
            }),
            run: vi.fn().mockResolvedValue({}),
          }),
        },
      };
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        text: vi.fn().mockResolvedValue('OK'),
      });
      vi.stubGlobal('fetch', fetchMock);

      await dispatchWebhooks(mockEnv as never, 'ws-1', 'lead.created', {});
      const callHeaders = fetchMock.mock.calls[0][1].headers;
      expect(callHeaders['X-Greenput-Signature']).toBeDefined();
      expect(callHeaders['X-Greenput-Signature']).toMatch(/^[0-9a-f]{64}$/);

      vi.unstubAllGlobals();
    });
  });
});

describe('webhook event filtering logic', () => {
  it('exact event match includes webhook', () => {
    const events = ['lead.created', 'job.updated'];
    const eventType = 'lead.created';
    expect(events.includes(eventType) || events.includes('*')).toBe(true);
  });

  it('non-matching event excludes webhook', () => {
    const events = ['lead.created', 'job.updated'];
    const eventType: WebhookEventType = 'campaign.created';
    expect(events.includes(eventType) || events.includes('*')).toBe(false);
  });

  it('wildcard * includes any event', () => {
    const events = ['*'];
    const eventType: WebhookEventType = 'payment.received';
    expect(events.includes(eventType) || events.includes('*')).toBe(true);
  });
});
