import type { ApiClient } from '@basenative/fetch';
import type { WorkspaceAvailability } from '@greenput/shared/models';
import type { UpdateAvailabilityInput } from '@greenput/shared/validators';

/**
 * `/api/availability` — when the contractor works (GP-101). One GET for the
 * week, the dated exceptions and the booking policy together; one PUT that
 * replaces all of it, because a partial week is not a meaningful state. The
 * body type is the validator's own input type, so the form cannot drift from
 * what the Worker accepts.
 */
export interface AvailabilityApi {
  get(): Promise<{ data: WorkspaceAvailability }>;
  update(
    input: UpdateAvailabilityInput,
  ): Promise<{ data: WorkspaceAvailability }>;
}

export function createAvailabilityApi(api: ApiClient): AvailabilityApi {
  return {
    get: () => api.get('/api/availability'),
    update: (input) => api.put('/api/availability', input),
  };
}
