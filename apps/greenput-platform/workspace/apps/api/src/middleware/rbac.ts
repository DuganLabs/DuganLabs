import type { IRequest } from 'itty-router';
import type { UserRole } from '@greenput/shared/models';
import type { SessionUser } from './auth';
import { error } from '../lib/response';

/** Numeric rank for role comparisons. Higher = more privileged. */
const ROLE_RANK: Record<UserRole, number> = {
  owner: 4,
  admin: 3,
  office: 2,
  tech: 1,
};

/**
 * Returns an itty-router middleware that rejects requests from users whose role
 * rank is lower than the specified minimum role.
 *
 * @example
 * // Require owner or admin
 * router.delete('/users/:id', requireAuth, requireRole('admin'), handler);
 */
export function requireRole(minRole: UserRole) {
  return function roleGuard(req: IRequest): Response | void {
    const user = (req as unknown as { user?: SessionUser }).user;

    if (!user) {
      return error('Unauthorized', 401, 'UNAUTHORIZED');
    }

    const userRank = ROLE_RANK[user.role as UserRole] ?? 0;
    const minRank = ROLE_RANK[minRole];

    if (userRank < minRank) {
      return error(
        `Forbidden: requires ${minRole} role or higher`,
        403,
        'FORBIDDEN',
      );
    }
  };
}
