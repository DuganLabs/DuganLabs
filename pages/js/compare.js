// ─── Tab switcher for code comparison ─────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const tabs = document.querySelectorAll('.cmp-tab');
  const panels = document.querySelectorAll('.cmp-panel');

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      for (const t of tabs) t.setAttribute('aria-selected', 'false');
      for (const p of panels) p.removeAttribute('data-active');

      tab.setAttribute('aria-selected', 'true');
      const panel = document.getElementById(tab.dataset.panel);
      if (panel) panel.setAttribute('data-active', '');
    });
  }
});
