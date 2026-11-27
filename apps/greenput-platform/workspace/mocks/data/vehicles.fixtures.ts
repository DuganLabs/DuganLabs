import type { Vehicle } from '@greenput/shared/models';

let counter = 0;

export function createVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  counter++;
  return {
    id: `veh-${counter}`,
    workspaceId: 'ws-1',
    name: `Service Van ${counter}`,
    make: 'Ford',
    model: 'Transit',
    year: 2022,
    licensePlate: `GP${counter}ABC`,
    vin: `1FTBF2A60NKA${String(counter).padStart(5, '0')}`,
    status: 'active',
    mileage: 15000 + counter * 1000,
    notes: '',
    createdAt: '2025-01-15T10:00:00Z',
    updatedAt: '2025-01-15T10:00:00Z',
    ...overrides,
  };
}

export function createVehicleList(n: number): Vehicle[] {
  return Array.from({ length: n }, () => createVehicle());
}

export function createVehicleResponse(
  vehicles: Vehicle[] = createVehicleList(3),
) {
  return {
    data: vehicles,
    meta: { total: vehicles.length, page: 1, perPage: 25 },
  };
}

export function resetVehicleCounter(): void {
  counter = 0;
}
