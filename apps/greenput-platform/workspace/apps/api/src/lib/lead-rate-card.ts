/**
 * The per-booked-lead rate card now lives in the shared models library
 * (libs/shared/models/src/lead-rate-card.ts) so the API and the tenant
 * site bill every booking from the same card. Re-exported here so the
 * API's imports keep working.
 */
export {
  GRANDFATHERED_LEAD_FEE_USD,
  LEAD_METER_INSERT_SQL,
  PER_LEAD_USD,
  PER_SERVICE_LEAD_USD,
  SERVICE_TO_ELECTRICAL_SERVICE,
  SERVICE_TO_VERTICAL,
  UnmappedLeadServiceError,
  WORKSPACE_LEAD_FEE_SQL,
  leadFeeOverrideUsd,
  priceUsdForWorkspace,
  priceUsdForWorkspaceRow,
  resolveLeadRate,
} from '@greenput/shared/models';
export type {
  ElectricalService,
  LeadRate,
  Vertical,
  WorkspaceLeadFeeRow,
} from '@greenput/shared/models';
