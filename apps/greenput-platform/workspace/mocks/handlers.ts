import { leadHandlers } from './handlers/lead.handlers';
import { opportunityHandlers } from './handlers/opportunity.handlers';
import { agentHandlers } from './handlers/agent.handlers';
import { dashboardHandlers } from './handlers/dashboard.handlers';
import { authHandlers } from './handlers/auth.handlers';
import { jobHandlers } from './handlers/job.handlers';
import { customerHandlers } from './handlers/customer.handlers';
import { campaignHandlers } from './handlers/campaign.handlers';
import { estimateHandlers } from './handlers/estimate.handlers';
import { reviewHandlers } from './handlers/review.handlers';
import { activityHandlers } from './handlers/activity.handlers';
import { webhookHandlers } from './handlers/webhooks.handlers';
import { brandingHandlers } from './handlers/branding.handlers';
import { apiKeysHandlers } from './handlers/api-keys.handlers';
import { pluginHandlers } from './handlers/plugins.handlers';
import { inventoryHandlers } from './handlers/inventory.handlers';
import { vehicleHandlers } from './handlers/vehicles.handlers';
import { reportHandlers } from './handlers/reports.handlers';
import { workspaceHandlers } from './handlers/workspace.handlers';
import { notificationHandlers } from './handlers/notifications.handlers';
import { chatHandlers } from './handlers/chat.handlers';
import { billingHandlers } from './handlers/billing.handlers';

export const handlers = [
  ...authHandlers,
  ...leadHandlers,
  ...opportunityHandlers,
  ...agentHandlers,
  ...dashboardHandlers,
  ...jobHandlers,
  ...customerHandlers,
  ...campaignHandlers,
  ...estimateHandlers,
  ...reviewHandlers,
  ...activityHandlers,
  ...webhookHandlers,
  ...brandingHandlers,
  ...apiKeysHandlers,
  ...pluginHandlers,
  ...inventoryHandlers,
  ...vehicleHandlers,
  ...reportHandlers,
  ...workspaceHandlers,
  ...notificationHandlers,
  ...chatHandlers,
  ...billingHandlers,
];
