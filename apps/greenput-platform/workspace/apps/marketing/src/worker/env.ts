import type { NotificationEnv } from '@greenput/shared/notifications';

export interface Env extends NotificationEnv {
  ENVIRONMENT: string;
  /**
   * Slug of the Greenput-owned workspace that receives greenput.com contact
   * submissions as leads (source "website"). Defaults to "greenput".
   */
  CONTACT_WORKSPACE_SLUG?: string;
}
