import { describe, expect, it } from 'vitest';
import { documentLocation } from './document-redirect';

const ID = '00000000-0000-4000-8000-000000000099';

function db(row: Record<string, string | null> | null) {
  return {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              return row;
            },
          };
        },
      };
    },
  };
}

describe('documentLocation', () => {
  it('sends a bare quote to the reference micro-site', async () => {
    await expect(
      documentLocation('greenput.com', '/quote', '', {}),
    ).resolves.toBe('https://demo.greenput.com/quote');
  });

  it('keeps the query string', async () => {
    await expect(
      documentLocation('greenput.com', '/quote', '?flow=panel', {}),
    ).resolves.toBe('https://demo.greenput.com/quote?flow=panel');
  });

  it('uses the staging domain for a staging host', async () => {
    await expect(
      documentLocation('greenput.site', '/invoice', '', {}),
    ).resolves.toBe('https://demo.greenput.site/invoice');
  });

  it('sends a proposal to the workspace that owns it', async () => {
    await expect(
      documentLocation(
        'www.greenput.com',
        `/proposal/${ID}`,
        '',
        db({
          slug: 'reed-hvac',
          custom_hostname: null,
          custom_domain_status: null,
        }),
      ),
    ).resolves.toBe(`https://reed-hvac.greenput.com/proposal/${ID}`);
  });

  it('prefers an active custom domain', async () => {
    await expect(
      documentLocation(
        'greenput.com',
        `/invoice/${ID}`,
        '',
        db({
          slug: 'reed-hvac',
          custom_hostname: 'www.reed.example',
          custom_domain_status: 'active',
        }),
      ),
    ).resolves.toBe(`https://www.reed.example/invoice/${ID}`);
  });

  it('falls back to the reference site when the database cannot answer', async () => {
    await expect(
      documentLocation('greenput.com', `/proposal/${ID}`, '', {
        prepare() {
          throw new Error('no table');
        },
      }),
    ).resolves.toBe(`https://demo.greenput.com/proposal/${ID}`);
  });

  it('ignores a page that is not a document', async () => {
    await expect(
      documentLocation('greenput.com', '/pricing', '', {}),
    ).resolves.toBeNull();
  });
});
