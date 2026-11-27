// Shared Zod validators — FE and BE
export {
  CreateLeadSchema,
  UpdateLeadSchema,
  ConvertLeadSchema,
  WithdrawLeadSchema,
  type CreateLeadInput,
  type UpdateLeadInput,
  type ConvertLeadInput,
  type WithdrawLeadInput,
} from './lead';

export {
  CreateOpportunitySchema,
  UpdateOpportunitySchema,
  ConvertOpportunitySchema,
  type CreateOpportunityInput,
  type UpdateOpportunityInput,
  type ConvertOpportunityInput,
} from './opportunity';

export {
  CreateJobSchema,
  UpdateJobSchema,
  LineItemSchema,
  type CreateJobInput,
  type UpdateJobInput,
} from './job';

export {
  CreateCustomerSchema,
  UpdateCustomerSchema,
  type CreateCustomerInput,
  type UpdateCustomerInput,
} from './customer';

export {
  CreateCampaignSchema,
  UpdateCampaignSchema,
  type CreateCampaignInput,
  type UpdateCampaignInput,
} from './campaign';

export {
  UpdateWorkspaceSchema,
  InviteUserSchema,
  UpdateUserRoleSchema,
  type UpdateWorkspaceInput,
  type InviteUserInput,
  type UpdateUserRoleInput,
} from './workspace';

export {
  AvailabilityDaySchema,
  AvailabilityExceptionSchema,
  LocalDateSchema,
  LocalTimeSchema,
  MAX_AVAILABILITY_EXCEPTIONS,
  TimeZoneSchema,
  UpdateAvailabilitySchema,
  isIanaTimeZone,
  type AvailabilityDayInput,
  type AvailabilityExceptionInput,
  type UpdateAvailabilityInput,
} from './availability';

export {
  RegisterSchema,
  OtpSendSchema,
  OtpVerifySchema,
  SetRecoveryPhoneSchema,
  ConfirmRecoveryPhoneSchema,
  type RegisterInput,
  type OtpSendInput,
  type OtpVerifyInput,
  type SetRecoveryPhoneInput,
  type ConfirmRecoveryPhoneInput,
} from './auth';

export {
  CreateWebhookSchema,
  UpdateWebhookSchema,
  type CreateWebhookInput,
  type UpdateWebhookInput,
} from './webhook';

export {
  InstallPluginSchema,
  UpdatePluginConfigSchema,
  PluginCategoryEnum,
  type InstallPluginInput,
  type UpdatePluginConfigInput,
} from './plugin';

export { UpdateBrandingSchema, type UpdateBrandingInput } from './branding';

export {
  RequestCustomDomainSchema,
  type RequestCustomDomainInput,
} from './custom-domain';

export {
  CreateReviewSchema,
  UpdateReviewSchema,
  CreateReviewRequestSchema,
  type CreateReviewInput,
  type UpdateReviewInput,
  type CreateReviewRequestInput,
} from './review';

export {
  CreateInventoryItemSchema,
  UpdateInventoryItemSchema,
  AdjustInventorySchema,
  type CreateInventoryItemInput,
  type UpdateInventoryItemInput,
  type AdjustInventoryInput,
} from './inventory';

export {
  CreateVehicleSchema,
  UpdateVehicleSchema,
  type CreateVehicleInput,
  type UpdateVehicleInput,
} from './vehicle';

export {
  CreateEstimateSchema,
  UpdateEstimateSchema,
  type CreateEstimateInput,
  type UpdateEstimateInput,
} from './estimate';

export {
  CreateChangeOrderSchema,
  DecideChangeOrderSchema,
  type CreateChangeOrderInput,
  type DecideChangeOrderInput,
} from './change-order';

export {
  CreateApiKeySchema,
  UpdateApiKeySchema,
  type CreateApiKeyInput,
  type UpdateApiKeyInput,
} from './api-key';

export {
  UpdateNotificationPreferencesSchema,
  type UpdateNotificationPreferencesInput,
  type NotificationPreferenceEntry,
} from './notification';

export {
  CreateUserWorkspaceSchema,
  SwitchWorkspaceSchema,
  type CreateUserWorkspaceInput,
  type SwitchWorkspaceInput,
} from './user-workspace';

export {
  SubscribeBillingSchema,
  BillingPortalSchema,
  UpdateUsageBalanceSchema,
  type SubscribeBillingInput,
  type BillingPortalInput,
  type UpdateUsageBalanceInput,
} from './billing';

export { AdminSetupSchema, type AdminSetupInput } from './admin';

export {
  StripeConnectLinkSchema,
  CreatePaymentIntentSchema,
  CreateDepositSchema,
  CustomerPortalMagicLinkSchema,
  type StripeConnectLinkInput,
  type CreatePaymentIntentInput,
  type CreateDepositInput,
  type CustomerPortalMagicLinkInput,
} from './payment';

export {
  CreateChatRoomSchema,
  SendChatMessageSchema,
  ChatSignalSchema,
  JoinChatRoomSchema,
  PublishTracksSchema,
  PullTracksSchema,
  RenegotiateSchema,
  type CreateChatRoomInput,
  type SendChatMessageInput,
  type ChatSignalInput,
  type JoinChatRoomInput,
  type PublishTracksInput,
  type PullTracksInput,
  type RenegotiateInput,
} from './chat';
