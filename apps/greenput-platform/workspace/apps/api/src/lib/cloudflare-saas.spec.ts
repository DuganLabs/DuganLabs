import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Env } from '../env';
import {
  createCustomHostname,
  getCustomHostname,
  deleteCustomHostname,
  mapCloudflareStatus,
  CloudflareSaasNotConfiguredError,
  CloudflareApiError,
} from './cloudflare-saas';

const UNCONFIGURED_ENV = { ENVIRONMENT: 'test' } as unknown as Env;
const CONFIGURED_ENV = {
  ENVIRONMENT: 'test',
  CLOUDFLARE_API_TOKEN: 'test-token',
  CLOUDFLARE_ZONE_ID: 'zone-123',
} as unknown as Env;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cloudflare-saas: not configured', () => {
  it('createCustomHostname throws CloudflareSaasNotConfiguredError without credentials', async () => {
    await expect(
      createCustomHostname(UNCONFIGURED_ENV, 'www.acme.com'),
    ).rejects.toBeInstanceOf(CloudflareSaasNotConfiguredError);
  });

  it('getCustomHostname throws CloudflareSaasNotConfiguredError without credentials', async () => {
    await expect(
      getCustomHostname(UNCONFIGURED_ENV, 'cf-id-1'),
    ).rejects.toBeInstanceOf(CloudflareSaasNotConfiguredError);
  });

  it('never calls fetch when unconfigured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      createCustomHostname(UNCONFIGURED_ENV, 'www.acme.com'),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('cloudflare-saas: createCustomHostname', () => {
  it('POSTs to /custom_hostnames with the fallback-origin (http) DCV method by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          errors: [],
          result: {
            id: 'cf-id-1',
            hostname: 'www.acme.com',
            status: 'pending',
            ssl: { status: 'pending_validation', method: 'http' },
          },
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await createCustomHostname(CONFIGURED_ENV, 'www.acme.com');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/zones/zone-123/custom_hostnames',
    );
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe('Bearer test-token');
    const body = JSON.parse(init.body);
    expect(body.hostname).toBe('www.acme.com');
    expect(body.ssl.method).toBe('http'); // 'cname' method maps to CF's 'http'
    expect(result.id).toBe('cf-id-1');
  });

  it('maps our "txt" DCV method to Cloudflare ssl.method "txt"', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          errors: [],
          result: {
            id: 'cf-id-2',
            hostname: 'www.acme.com',
            status: 'pending',
            ssl: { status: 'pending_validation', method: 'txt' },
          },
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await createCustomHostname(CONFIGURED_ENV, 'www.acme.com', 'txt');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.ssl.method).toBe('txt');
  });

  it('throws CloudflareApiError with the Cloudflare message when the API rejects the request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: () =>
        Promise.resolve({
          success: false,
          errors: [{ code: 1406, message: 'Duplicate custom hostname found' }],
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createCustomHostname(CONFIGURED_ENV, 'www.acme.com'),
    ).rejects.toMatchObject({
      name: 'CloudflareApiError',
      message: 'Duplicate custom hostname found',
      status: 409,
    });
  });
});

describe('cloudflare-saas: getCustomHostname / deleteCustomHostname', () => {
  it('GETs the hostname by id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          errors: [],
          result: {
            id: 'cf-id-1',
            hostname: 'www.acme.com',
            status: 'active',
            ssl: { status: 'active', method: 'http' },
          },
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await getCustomHostname(CONFIGURED_ENV, 'cf-id-1');
    expect(fetchMock.mock.calls[0][1].method).toBe('GET');
    expect(result.status).toBe('active');
  });

  it('DELETEs the hostname by id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, errors: [], result: {} }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await deleteCustomHostname(CONFIGURED_ENV, 'cf-id-1');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.cloudflare.com/client/v4/zones/zone-123/custom_hostnames/cf-id-1',
    );
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });
});

describe('mapCloudflareStatus', () => {
  it('maps status=active + ssl.status=active to "active"', () => {
    expect(
      mapCloudflareStatus({
        status: 'active',
        ssl: { status: 'active', method: 'http' },
      }),
    ).toBe('active');
  });

  it('maps a fresh pending hostname to "verifying"', () => {
    expect(
      mapCloudflareStatus({
        status: 'pending',
        ssl: { status: 'pending_validation', method: 'http' },
      }),
    ).toBe('verifying');
  });

  it('maps active hostname status with pending ssl to "verifying" (cert not issued yet)', () => {
    expect(
      mapCloudflareStatus({
        status: 'active',
        ssl: { status: 'pending_issuance', method: 'http' },
      }),
    ).toBe('verifying');
  });

  it('maps a timed-out validation to "failed"', () => {
    expect(
      mapCloudflareStatus({
        status: 'pending',
        ssl: { status: 'validation_timed_out', method: 'http' },
      }),
    ).toBe('failed');
  });

  it('maps a blocked hostname to "failed"', () => {
    expect(
      mapCloudflareStatus({
        status: 'pending_blocked',
        ssl: { status: 'pending_validation', method: 'http' },
      }),
    ).toBe('failed');
  });

  it('maps a deleted hostname to "failed"', () => {
    expect(
      mapCloudflareStatus({
        status: 'deleted',
        ssl: { status: 'deleted', method: 'http' },
      }),
    ).toBe('failed');
  });
});

describe('CloudflareSaasNotConfiguredError / CloudflareApiError', () => {
  it('CloudflareSaasNotConfiguredError is an Error with a helpful message', () => {
    const err = new CloudflareSaasNotConfiguredError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CloudflareSaasNotConfiguredError');
    expect(err.message).toMatch(/CLOUDFLARE_API_TOKEN/);
  });

  it('CloudflareApiError carries status and errors', () => {
    const err = new CloudflareApiError('bad request', 400, [
      { code: 1, message: 'bad request' },
    ]);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(400);
    expect(err.errors).toHaveLength(1);
  });
});
