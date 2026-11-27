import type { InventoryItem } from '@greenput/shared/models';

let counter = 0;

export function createInventoryItem(
  overrides: Partial<InventoryItem> = {},
): InventoryItem {
  counter++;
  return {
    id: `inv-${counter}`,
    workspaceId: 'ws-1',
    name: `Part ${counter}`,
    sku: `SKU-${counter}`,
    description: `Standard part ${counter}`,
    category: 'general',
    quantity: 10 + counter,
    minQuantity: 2,
    unitCost: 1500, // $15.00 in cents
    unitPrice: 2500, // $25.00 in cents
    supplier: 'Acme Supply',
    location: 'Warehouse A',
    createdAt: '2025-01-15T10:00:00Z',
    updatedAt: '2025-01-15T10:00:00Z',
    ...overrides,
  };
}

export function createInventoryList(n: number): InventoryItem[] {
  return Array.from({ length: n }, () => createInventoryItem());
}

export function createInventoryResponse(
  items: InventoryItem[] = createInventoryList(3),
) {
  return {
    data: items,
    meta: { total: items.length, page: 1, perPage: 25 },
  };
}

export function resetInventoryCounter(): void {
  counter = 0;
}
