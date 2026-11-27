import { http, HttpResponse } from 'msw';
import {
  createInventoryItem,
  createInventoryResponse,
} from '../data/inventory.fixtures';

export const getInventorySuccess = http.get(
  '*/api/inventory',
  async ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/low-stock')) {
      return HttpResponse.json({
        data: [],
        meta: { total: 0, page: 1, perPage: 25 },
      });
    }
    return HttpResponse.json(createInventoryResponse());
  },
);

export const getLowStockSuccess = http.get(
  '*/api/inventory/low-stock',
  async () => {
    return HttpResponse.json({
      data: [],
      meta: { total: 0, page: 1, perPage: 25 },
    });
  },
);

export const createInventoryItemSuccess = http.post(
  '*/api/inventory',
  async () => {
    return HttpResponse.json({ data: createInventoryItem() }, { status: 201 });
  },
);

export const updateInventoryItemSuccess = http.patch(
  '*/api/inventory/:id',
  async ({ params }) => {
    return HttpResponse.json({
      data: createInventoryItem({ id: params['id'] as string }),
    });
  },
);

export const deleteInventoryItemSuccess = http.delete(
  '*/api/inventory/:id',
  async () => {
    return HttpResponse.json({ data: { deleted: true } });
  },
);

export const adjustInventorySuccess = http.post(
  '*/api/inventory/:id/adjust',
  async () => {
    return HttpResponse.json({
      data: {
        id: 'txn-1',
        type: 'purchase',
        quantity: 5,
        notes: '',
        createdAt: new Date().toISOString(),
      },
    });
  },
);

export const inventoryHandlers = [
  getLowStockSuccess,
  getInventorySuccess,
  createInventoryItemSuccess,
  updateInventoryItemSuccess,
  deleteInventoryItemSuccess,
  adjustInventorySuccess,
];
