import { http, HttpResponse } from 'msw';
import {
  createVehicle,
  createVehicleResponse,
} from '../data/vehicles.fixtures';

// ── Success handlers ────────────────────────────────────────

export const getVehiclesSuccess = http.get('*/api/vehicles', async () => {
  return HttpResponse.json(createVehicleResponse());
});

export const createVehicleSuccess = http.post('*/api/vehicles', async () => {
  return HttpResponse.json({ data: createVehicle() }, { status: 201 });
});

export const updateVehicleSuccess = http.patch(
  '*/api/vehicles/:id',
  async ({ params }) => {
    return HttpResponse.json({
      data: createVehicle({ id: params['id'] as string }),
    });
  },
);

export const deleteVehicleSuccess = http.delete(
  '*/api/vehicles/:id',
  async () => {
    return HttpResponse.json({ data: { deleted: true } });
  },
);

// ── Empty handlers ──────────────────────────────────────────

export const getVehiclesEmpty = http.get('*/api/vehicles', async () => {
  return HttpResponse.json({
    data: [],
    meta: { total: 0, page: 1, perPage: 25 },
  });
});

// ── Error handlers ──────────────────────────────────────────

export const getVehiclesError500 = http.get('*/api/vehicles', async () => {
  return HttpResponse.json(
    { message: 'Internal server error' },
    { status: 500 },
  );
});

// ── Default export ──────────────────────────────────────────

export const vehicleHandlers = [
  getVehiclesSuccess,
  createVehicleSuccess,
  updateVehicleSuccess,
  deleteVehicleSuccess,
];
