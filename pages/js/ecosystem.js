import { renderPackageCard } from '../vendor/basenative/marketplace/card.js';

// The card markup comes from @basenative/marketplace — the package this page
// exists to dogfood — not from a copy of it kept here. worker/index.js imports
// the same module for SSR. headingLevel: 3 puts the package names under this
// page's <h1> and its "Packages" heading without skipping a level; the default
// (4) is upstream's.
const PKG_CARD_OPTIONS = { headingLevel: 3 };

const BASE = '/api';
const grid = document.getElementById('eco-grid');
const countEl = document.getElementById('eco-count');
const searchInput = document.getElementById('eco-search');
const categoriesContainer = document.getElementById('eco-categories');

let activeCategory = '';

async function loadPackages() {
  const q = searchInput?.value?.trim() || '';
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (activeCategory) params.set('category', activeCategory);

  try {
    const res = await fetch(`${BASE}/ecosystem?${params}`);
    if (!res.ok) throw new Error('Failed to load');
    const data = await res.json();
    renderGrid(data.packages || []);
  } catch {
    if (grid) grid.innerHTML = '<p class="eco-empty">Failed to load packages.</p>';
  }
}

async function loadCategories() {
  try {
    const res = await fetch(`${BASE}/ecosystem/categories`);
    if (!res.ok) return;
    const cats = await res.json();

    if (!categoriesContainer) return;
    // Keep "All" button, add category buttons
    for (const cat of cats) {
      const btn = document.createElement('button');
      btn.className = 'eco-cat-btn';
      btn.setAttribute('aria-pressed', 'false');
      btn.dataset.category = cat.name;
      btn.textContent = `${cat.name} (${cat.count})`;
      categoriesContainer.appendChild(btn);
    }
  } catch {
    // Non-critical
  }
}

function renderGrid(packages) {
  if (!grid) return;

  if (packages.length === 0) {
    grid.innerHTML = '<p class="eco-empty">No packages found.</p>';
    if (countEl) countEl.textContent = '';
    return;
  }

  if (countEl) countEl.textContent = `${packages.length} package${packages.length !== 1 ? 's' : ''}`;

  grid.innerHTML = packages.map(pkg => renderPackageCard(pkg, PKG_CARD_OPTIONS)).join('');
}

// ── Events ───────────────────────────────────────────────

let searchTimeout;
searchInput?.addEventListener('input', () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(loadPackages, 300);
});

categoriesContainer?.addEventListener('click', (e) => {
  const btn = e.target.closest('.eco-cat-btn');
  if (!btn) return;

  activeCategory = btn.dataset.category || '';

  // Update aria-pressed
  for (const b of categoriesContainer.querySelectorAll('.eco-cat-btn')) {
    b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
  }

  loadPackages();
});

// ── Init ─────────────────────────────────────────────────

// The worker server-renders the package grid and category buttons into
// #eco-grid / #eco-categories before the response ever reaches the browser
// (see worker/index.js renderEcosystemPage). When that happened, the grid
// carries data-ssr="1" and already has the real content and category
// buttons — re-fetching on load would just flash "Loading packages..." and
// duplicate the category buttons. Search and category-click filtering
// still work either way since those call loadPackages() directly.
const isSSR = grid?.dataset.ssr === '1';
if (!isSSR) {
  loadCategories();
  loadPackages();
}
