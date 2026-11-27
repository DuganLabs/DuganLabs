export interface Env {
  /** The same `greenput` database `apps/api` writes. Read-only here. */
  DB: D1Database;
  ENVIRONMENT: string;
}
