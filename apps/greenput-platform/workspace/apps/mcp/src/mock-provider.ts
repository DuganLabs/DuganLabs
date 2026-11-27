import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type {
  BookingLeadPayload,
  ContractorResult,
  FindContractorsInput,
  StartQuoteInput,
} from './contracts.js';
import type {
  BookingReceiptData,
  DiscoveryProvider,
  FindContractorsData,
  QuoteSessionData,
} from './provider.js';

/**
 * MockProvider — fixture data for contract testing. Nothing here is real:
 * every business name is prefixed "MOCK —", every business is fictional,
 * every price is a round number. If a fixture ever looks like a real
 * business or a real person, that is a bug in this file.
 *
 * Coverage: electricians in Irvine / Orange County for the five seeded
 * services. Anything outside that (Denver is the canonical probe) returns
 * the honest empty state.
 */

interface MockShop {
  /** v1 shop_id: the slug from the directory profile URL. */
  id: string;
  result: ContractorResult;
  /** Lowercase cities this shop takes work in. */
  cities: string[];
  /** True if the shop takes work anywhere in Orange County. */
  countyWide: boolean;
  /** Schedule-management enrollment fixture (item 10b): the services
   * this shop auto-books, and the windows it exposed. Shops without a
   * schedule never confirm in chat — their bookings take the request
   * flow, exactly like a real unenrolled shop. */
  schedule?: {
    timezone: string;
    services: string[];
    windows: { dayOfWeek: number; startMinute: number; endMinute: number }[];
    durationMinutes: number;
  };
}

const DIRECTORY_BASE = 'https://greenput.com/directory';

const MOCK_SHOPS: MockShop[] = [
  {
    id: 'mock-suntest-electric',
    cities: ['irvine', 'tustin', 'lake forest'],
    countyWide: false,
    schedule: {
      timezone: 'America/Los_Angeles',
      services: ['ev-charger-install', 'panel-upgrade'],
      windows: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
        dayOfWeek,
        startMinute: 480,
        endMinute: 1020,
      })),
      durationMinutes: 120,
    },
    result: {
      business_name: 'MOCK — SunTest Electric Co.',
      services: [
        'ev-charger-install',
        'panel-upgrade',
        'circuit-outlet',
        'troubleshooting',
        'surge-protection',
      ],
      service_area: 'Irvine, Tustin, and Lake Forest',
      certifications: ['tesla-certified', 'cslb-c10'],
      profile_url: `${DIRECTORY_BASE}/mock-suntest-electric`,
    },
  },
  {
    id: 'mock-pacific-fictional-electric',
    cities: ['irvine', 'newport beach', 'costa mesa'],
    countyWide: false,
    result: {
      business_name: 'MOCK — Pacific Fictional Electric',
      services: ['ev-charger-install', 'panel-upgrade', 'circuit-outlet'],
      service_area: 'Irvine, Newport Beach, and Costa Mesa',
      certifications: ['tesla-certified'],
      profile_url: `${DIRECTORY_BASE}/mock-pacific-fictional-electric`,
    },
  },
  {
    id: 'mock-example-amp-wire',
    cities: ['costa mesa', 'huntington beach', 'santa ana'],
    countyWide: false,
    result: {
      business_name: 'MOCK — Example Amp & Wire LLC',
      services: ['troubleshooting', 'surge-protection', 'circuit-outlet'],
      service_area: 'Costa Mesa, Huntington Beach, and Santa Ana',
      certifications: [],
      profile_url: `${DIRECTORY_BASE}/mock-example-amp-wire`,
    },
  },
  {
    id: 'mock-countywide-fictional-electric',
    cities: [],
    countyWide: true,
    result: {
      business_name: 'MOCK — Countywide Fictional Electric',
      services: ['ev-charger-install', 'panel-upgrade'],
      service_area: 'All of Orange County',
      certifications: ['tesla-certified'],
      profile_url: `${DIRECTORY_BASE}/mock-countywide-fictional-electric`,
    },
  },
];

/** Orange County cities the fixtures know about. */
const OC_CITIES = new Set([
  'irvine',
  'tustin',
  'lake forest',
  'newport beach',
  'costa mesa',
  'huntington beach',
  'santa ana',
  'anaheim',
  'orange',
  'mission viejo',
  'fullerton',
  'garden grove',
  'yorba linda',
  'san clemente',
  'laguna niguel',
  'fountain valley',
  'westminster',
  'buena park',
  'brea',
  'placentia',
  'dana point',
  'aliso viejo',
  'rancho santa margarita',
]);

type LocationMatch =
  { covered: true; city: string | null } | { covered: false };

/** Resolve a free-text location to mock coverage. ZIPs 926/927/928 are
 * Orange County; known OC city names match by city; anything else is
 * honestly uncovered. */
function matchLocation(rawLocation: string): LocationMatch {
  const location = rawLocation.trim().toLowerCase();
  const zip = /^(\d{5})(?:-\d{4})?$/.exec(location);
  if (zip) {
    const prefix = (zip[1] ?? '').slice(0, 3);
    return ['926', '927', '928'].includes(prefix)
      ? { covered: true, city: null }
      : { covered: false };
  }
  const city = location.split(',')[0]?.trim() ?? '';
  if (city === 'orange county') return { covered: true, city: null };
  if (OC_CITIES.has(city)) return { covered: true, city };
  return { covered: false };
}

export class MockProvider implements DiscoveryProvider {
  readonly dataMode = 'mock' as const;

  /** The booking sink, in memory. Tests inspect this directly. */
  readonly bookings: BookingLeadPayload[] = [];

  constructor(private readonly bookingFilePath?: string) {}

  async findContractors(
    input: FindContractorsInput,
  ): Promise<FindContractorsData> {
    const match = matchLocation(input.location);
    if (!match.covered) {
      return {
        results: [],
        coverageNote:
          `GreenPut has no verified coverage in ${input.location} yet. ` +
          'The nearest covered area is Orange County, California.',
      };
    }

    const wantsCert = input.certification?.trim().toLowerCase();
    const matches = MOCK_SHOPS.filter((shop) => {
      if (!shop.result.services.includes(input.service)) return false;
      if (
        wantsCert &&
        !shop.result.certifications.some((c) => c.toLowerCase() === wantsCert)
      ) {
        return false;
      }
      if (match.city === null) return true; // county-level query
      return shop.countyWide || shop.cities.includes(match.city);
    });

    // Order by fit: shops based in the queried city before county-wide ones.
    const ordered = [...matches].sort((a, b) => {
      const aExact = match.city !== null && a.cities.includes(match.city);
      const bExact = match.city !== null && b.cities.includes(match.city);
      return Number(bExact) - Number(aExact);
    });

    return {
      results: ordered.map((shop) => shop.result),
      coverageNote:
        ordered.length > 0
          ? 'Covered area: Orange County, California.'
          : 'Orange County, California is covered, but no verified shop ' +
            'matches that request yet.',
    };
  }

  async startQuote(input: StartQuoteInput): Promise<QuoteSessionData> {
    // A quote opens with no price. The mock does not run the engine's
    // questions; it only names the engine the quote would run on.
    return {
      basis: `mock-engine/${input.service}/v1 (fixture — not connected to the real pricing engine)`,
      sourceUrl: 'https://greenput.com/pricing',
    };
  }

  async submitBooking(
    payload: BookingLeadPayload,
  ): Promise<BookingReceiptData> {
    const shop = MOCK_SHOPS.find((s) => s.id === payload.shop_id);
    if (!shop) {
      throw new Error(
        `Unknown shop_id "${payload.shop_id}". Bookings can only go to a ` +
          'shop returned by find_contractors.',
      );
    }
    this.bookings.push(payload);
    if (this.bookingFilePath) {
      appendFileSync(
        this.bookingFilePath,
        `${JSON.stringify(payload)}\n`,
        'utf8',
      );
    }
    return {
      confirmationRef: `mock-conf-${randomUUID()}`,
      grantId: `mock-grant-${randomUUID()}`,
      shopBusinessName: shop.result.business_name,
      confirmedSlot: mockConfirmedSlot(shop, payload.service),
    };
  }
}

/**
 * The mock's miniature of the delivery engine. The real slot-finding
 * lives in libs/shared/scheduling (findAutoBookSlot) behind the API's
 * enrollment tables; this fixture version applies the same rule in
 * small: only an enrolled service, only inside an exposed window, the
 * next 30-minute grid start at least an hour out. Anything else returns
 * undefined and the booking takes the request flow.
 */
function mockConfirmedSlot(
  shop: MockShop,
  service: string,
): { start: string; end: string; timezone: string } | undefined {
  const schedule = shop.schedule;
  if (!schedule || !schedule.services.includes(service)) return undefined;
  const tz = schedule.timezone;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const dayIndex: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  // Scan forward up to two weeks for the first in-window grid start,
  // snapped to the 30-minute grid, at least an hour out.
  const gridMs = 30 * 60_000;
  const firstCandidate = Math.ceil((Date.now() + 3_600_000) / gridMs) * gridMs;
  for (
    let t = firstCandidate;
    t <= firstCandidate + 14 * 24 * 3_600_000;
    t += gridMs
  ) {
    const candidate = new Date(t);
    const parts = fmt.formatToParts(candidate);
    const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? NaN);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? NaN);
    const minuteOfDay = hour * 60 + minute;
    const window = schedule.windows.find(
      (w) =>
        w.dayOfWeek === dayIndex[weekday] &&
        minuteOfDay >= w.startMinute &&
        minuteOfDay + schedule.durationMinutes <= w.endMinute &&
        minute % 30 === 0,
    );
    if (window) {
      return {
        start: candidate.toISOString(),
        end: new Date(
          candidate.getTime() + schedule.durationMinutes * 60_000,
        ).toISOString(),
        timezone: tz,
      };
    }
  }
  return undefined;
}
