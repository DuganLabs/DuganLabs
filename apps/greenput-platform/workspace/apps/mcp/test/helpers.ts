import { MockProvider } from '../src/mock-provider.js';
import type { BookingLeadPayload } from '../src/contracts.js';
import type { DiscoveryProvider } from '../src/provider.js';

/**
 * Provider factory for the contract suite. PROVIDER_UNDER_TEST selects the
 * implementation (default "mock"). When the real provider exists, it gets
 * a case here — and must pass test/contracts.test.ts unchanged.
 */
export interface ProviderUnderTest {
  provider: DiscoveryProvider;
  inspectBookings: () => BookingLeadPayload[];
}

export function createProviderUnderTest(): ProviderUnderTest {
  const name = process.env.PROVIDER_UNDER_TEST ?? 'mock';
  switch (name) {
    case 'mock': {
      const provider = new MockProvider();
      return {
        provider,
        inspectBookings: () => [...provider.bookings],
      };
    }
    default:
      throw new Error(
        `Unknown PROVIDER_UNDER_TEST "${name}". Known providers: mock.`,
      );
  }
}
