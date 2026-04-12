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

  grid.innerHTML = packages.map(pkg => renderCard(pkg)).join('');
}

function renderCard(pkg) {
  const tags = (pkg.tags || [])
    .map(t => `<span data-bn="pkg-tag">${esc(t)}</span>`)
    .join('');

  const repoLink = pkg.repo
    ? `<a href="${esc(pkg.repo)}" target="_blank" rel="noopener">${esc(pkg.name)}</a>`
    : esc(pkg.name);

  return `<article data-bn="pkg-card">
  <div data-bn="pkg-header">
    <h4 data-bn="pkg-name">${repoLink}</h4>
    ${pkg.category ? `<span data-bn="pkg-category">${esc(pkg.category)}</span>` : ''}
  </div>
  ${pkg.description ? `<p data-bn="pkg-desc">${esc(pkg.description)}</p>` : ''}
  ${tags ? `<div data-bn="pkg-tags">${tags}</div>` : ''}
  <div data-bn="pkg-stats">
    ${pkg.version ? `<span>v${esc(pkg.version)}</span>` : ''}
  </div>
</article>`;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
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

loadCategories();
loadPackages();
