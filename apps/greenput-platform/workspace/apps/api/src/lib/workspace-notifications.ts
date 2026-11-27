import {
  dispatchNotification,
  type NotificationEvent,
} from '@greenput/shared/notifications';
import type { Env } from '../env';
import { sendContractorSms } from './usage-balance';

/**
 * Notifications sent on a contractor workspace's behalf (lead alerts,
 * job updates, review requests). SMS reserves that workspace's usage
 * balance through `sendContractorSms`. The shared dispatcher never
 * imports this module: the hook is injected here.
 *
 * GreenPut-paid messages do not come through here. The marketing contact
 * form calls `dispatchNotification` with no hook, and account-recovery
 * OTP uses its own sender in `routes/otp.ts`.
 */
export function dispatchWorkspaceNotification(
  env: Env,
  event: NotificationEvent,
): Promise<void> {
  return dispatchNotification(env, event, {
    smsBilling: {
      send: (args) => sendContractorSms(env, args),
    },
  });
}
