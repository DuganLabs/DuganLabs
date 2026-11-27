import { signal, computed, effect, hydrate } from '/basenative.js';

// -- SSR Hydration verification --
const initialData = JSON.parse(document.querySelector('[data-initial-items]').textContent);

const items = signal(initialData);
const visible = signal(true);
const count = signal(0);

const itemCount = computed(() => items().length);
const counterLabel = computed(() => {
  const n = count();
  return `${n} (${n >= 0 ? 'positive' : 'negative'})`;
});

// Hydration status
const statusEl = document.querySelector('[data-hydration-status]');
if (initialData.length === items().length) {
  statusEl.textContent = `Hydration OK — ${initialData.length} items from server match signal state`;
  statusEl.dataset.status = 'active';
} else {
  statusEl.textContent = 'Hydration MISMATCH';
  statusEl.dataset.status = 'error';
}

// -- Reactive section --
const output = document.querySelector('[data-test-output]');
const counterValue = document.querySelector('[data-counter-value]');
const testList = document.querySelector('[data-test-list]');
const testCount = document.querySelector('[data-test-count]');

// Effect: update output
effect(() => {
  output.textContent = `${itemCount()} items · visible: ${visible()} · counter: ${count()}`;
});

// Effect: render list
effect(() => {
  testList.innerHTML = '';
  if (!visible()) return;
  for (const item of items()) {
    const li = document.createElement('li');
    li.textContent = `${item.name} [${item.status}]`;
    testList.append(li);
  }
});

// Effect: update counter display
effect(() => {
  counterValue.textContent = counterLabel();
});

// Effect: update count display
effect(() => {
  if (testCount) testCount.textContent = itemCount();
});

// Hydrate the @if/@else templates
const computedSection = document.querySelector('[data-test-computed]');
hydrate(computedSection, { visible, items, itemCount, String });

// -- Button handlers --
let nextId = initialData.length + 1;

document.querySelector('[data-test-action="add"]').addEventListener('click', () => {
  items.set((prev) => [...prev, { id: nextId++, name: `Item ${nextId - 1}`, status: 'active' }]);
});

document.querySelector('[data-test-action="remove"]').addEventListener('click', () => {
  items.set((prev) => prev.slice(0, -1));
});

document.querySelector('[data-test-action="toggle"]').addEventListener('click', () => {
  visible.set((v) => !v);
});

document.querySelector('[data-test-action="increment"]').addEventListener('click', () => {
  count.set((c) => c + 1);
});

document.querySelector('[data-test-action="decrement"]').addEventListener('click', () => {
  count.set((c) => c - 1);
});
