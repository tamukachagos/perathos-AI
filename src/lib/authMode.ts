import { hasDatabase, isDevMockMode } from "@/lib/env";

export type AuthMode = "mock" | "email" | "unconfigured";

/**
 * Single source of truth for the sign-in surface. Production never falls back to
 * passwordless dev credentials just because the database/email setup is missing.
 */
export function getAuthMode(): AuthMode {
  if (isDevMockMode()) return "mock";
  if (hasDatabase() && process.env.EMAIL_SERVER?.trim()) return "email";
  return "unconfigured";
}
