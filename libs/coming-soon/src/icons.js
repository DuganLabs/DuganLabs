// Inline SVG icons (stroke, currentColor). Decorative: aria-hidden.
const svg = (d, size = 18) => `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const icons = {
  check: (s) => svg('<path d="M20 6 9 17l-5-5"/>', s),
  lock: (s) => svg('<rect x="4" y="10.5" width="16" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>', s),
  shield: (s) => svg('<path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.3 7.5 9.5 4.4-1.2 7.5-4.9 7.5-9.5V6L12 3Z"/>', s),
  spark: (s) => svg('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>', s),
  inbox: (s) => svg('<path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5.5 5h13L21 13v6H3v-6l2.5-8Z"/>', s),
  calendar: (s) => svg('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>', s),
  card: (s) => svg('<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h4"/>', s),
  clock: (s) => svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', s),
  layers: (s) => svg('<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>', s),
  trend: (s) => svg('<path d="M3 17 9 11l4 4 8-8"/><path d="M15 7h6v6"/>', s),
  arrow: (s) => svg('<path d="M5 12h14M13 6l6 6-6 6"/>', s),
};
export const icon = (name, size) => (icons[name] ?? icons.spark)(size);
