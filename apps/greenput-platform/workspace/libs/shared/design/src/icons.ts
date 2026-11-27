/**
 * The platform's navigation icons.
 *
 * Before this, `nav-items.ts` shipped a single letter per route ("D
 * Dashboard", "L Leads", "Σ Reports") — placeholder text that read as
 * scaffolding and, at a glance in a van, as noise. These are drawn on one
 * 24-unit grid at a single 1.75px stroke so the row of them reads as a set:
 * one weight, round caps, no fills, nothing that needs colour to be legible.
 */

const S = (d: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const GP_ICONS = {
  /** Today — a day split into its parts. */
  dashboard: S('<path d="M4 13h6v7H4zM4 4h6v5H4zM14 4h6v7h-6zM14 15h6v5h-6"/>'),
  /** Leads — a person who has just arrived. */
  leads: S(
    '<path d="M16 20v-1.5A3.5 3.5 0 0 0 12.5 15h-5A3.5 3.5 0 0 0 4 18.5V20"/><circle cx="10" cy="8" r="3.4"/><path d="M18 5v6M21 8h-6"/>',
  ),
  /** Opportunities — money still in the air. */
  opportunities: S('<path d="M4 19V6M4 19h16"/><path d="M8 15l4-5 3 3 5-6"/>'),
  /** Customers — people you have already worked for. */
  customers: S(
    '<circle cx="9" cy="8" r="3.2"/><path d="M3 20v-1.2A3.8 3.8 0 0 1 6.8 15h4.4A3.8 3.8 0 0 1 15 18.8V20"/><path d="M16.5 5.3a3.2 3.2 0 0 1 0 5.4M18 15h.4a3.6 3.6 0 0 1 3.6 3.6V20"/>',
  ),
  /** Estimates — a priced sheet. */
  estimates: S(
    '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 16h4"/>',
  ),
  /** Jobs — work with a time on it. */
  jobs: S(
    '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M8 15h3"/>',
  ),
  /** Campaigns — reaching out. */
  campaigns: S(
    '<path d="M4 10v4a1 1 0 0 0 1 1h2l5 4V5L7 9H5a1 1 0 0 0-1 1Z"/><path d="M17 9.5a4 4 0 0 1 0 5M19.5 7a7.5 7.5 0 0 1 0 10"/>',
  ),
  /** Inventory — what is on the van. */
  inventory: S(
    '<path d="M3 8l9-4 9 4v8l-9 4-9-4Z"/><path d="M3 8l9 4 9-4M12 12v8"/>',
  ),
  /** Vehicles — the van itself. */
  vehicles: S(
    '<path d="M2 16V9h11v7M13 11h4l4 4v1h-8"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  ),
  /** Reviews — what the neighbours said. */
  reviews: S(
    '<path d="M12 4l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 9.7l5.4-.8Z"/>',
  ),
  /** Reports — the shape of the month. */
  reports: S(
    '<path d="M4 20V5M4 20h16"/><rect x="7" y="12" width="3" height="5"/><rect x="12.5" y="8" width="3" height="9"/><rect x="18" y="14" width="3" height="3"/>',
  ),
  /** Plugins — things bolted on. */
  plugins: S(
    '<path d="M9 3v5M15 3v5"/><path d="M6 8h12v5a6 6 0 0 1-12 0Z"/><path d="M12 19v2"/>',
  ),
  /** Activity — what just happened. */
  activity: S('<path d="M3 12h4l3 7 4-14 3 7h4"/>'),
  /** Chat — the crew. */
  chat: S(
    '<path d="M20 14a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2Z"/><path d="M8 9h8M8 12h5"/>',
  ),
  /** Settings — the business behind the business. */
  settings: S(
    '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3"/>',
  ),
} as const satisfies Record<string, string>;

export type GpIconName = keyof typeof GP_ICONS;

/** Menu / drawer toggle, drawn on the same grid as the nav icons. */
export const GP_ICON_MENU = S('<path d="M4 7h16M4 12h16M4 17h16"/>');
export const GP_ICON_CLOSE = S('<path d="M6 6l12 12M18 6 6 18"/>');
export const GP_ICON_PLUS = S('<path d="M12 5v14M5 12h14"/>');
export const GP_ICON_CHEVRON_LEFT = S('<path d="M14.5 5 8 12l6.5 7"/>');
export const GP_ICON_CHEVRON_RIGHT = S('<path d="M9.5 5 16 12l-6.5 7"/>');
export const GP_ICON_SEARCH = S(
  '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
);
export const GP_ICON_PHONE = S(
  '<path d="M21 16.9v2.6a2 2 0 0 1-2.2 2 19.5 19.5 0 0 1-8.5-3A19.2 19.2 0 0 1 4.4 12 19.5 19.5 0 0 1 1.4 3.4 2 2 0 0 1 3.4 1.2H6a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.7a2 2 0 0 1-.4 2.1L7 8.9a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.4c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2Z"/>',
);
export const GP_ICON_MAIL = S(
  '<rect x="2.5" y="4.5" width="19" height="15" rx="2"/><path d="m3 6 8.4 5.6a1.8 1.8 0 0 0 2 0L22 6"/>',
);
export const GP_ICON_CHECK = S('<path d="m4.5 12.5 5 5 10-11"/>');
export const GP_ICON_SHIELD = S(
  '<path d="M12 2.8 4.5 6v6.1c0 4.3 3.1 7.6 7.5 9.1 4.4-1.5 7.5-4.8 7.5-9.1V6Z"/><path d="m8.8 12 2.2 2.2 4.3-4.5"/>',
);
export const GP_ICON_CLOCK = S(
  '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.3l3.3 2"/>',
);
export const GP_ICON_PIN = S(
  '<path d="M20 10.3c0 5.3-8 11.5-8 11.5s-8-6.2-8-11.5a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.8"/>',
);
export const GP_ICON_STAR = S(
  '<path d="M12 4l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 9.7l5.4-.8Z"/>',
);
