// Auth.js v5 (NextAuth) configuration.
//
// Two paths, chosen by env with ZERO code change:
//
//  * Postgres mode (DATABASE_URL set): the Prisma adapter + DATABASE sessions +
//    a magic-link email (Nodemailer) provider. DB sessions give instant
//    revocation (per ARCHITECTURE.md).
//
//  * Mock mode (no DATABASE_URL): NO adapter, a JWT session, and a dev
//    Credentials provider that signs in any email with no password and no email
//    delivery — so the auth flow is fully exercisable with no DB and no secrets.
//
// The Prisma adapter and client are imported statically but only WIRED when a
// real database is configured; the client does not connect until a query runs,
// so `next build` with no DATABASE_URL never touches Postgres.

import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Nodemailer from "next-auth/providers/nodemailer";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { env } from "@/lib/env";
import { getAuthMode } from "@/lib/authMode";
import { prisma } from "@/lib/db/prisma/client";
import { DEV_USER_EMAIL, DEV_USER_ID } from "@/lib/db/seed";

// A stable dev secret so mock mode needs no AUTH_SECRET. Real deployments MUST
// set AUTH_SECRET; this fallback is ONLY ever used in explicit dev/mock mode.
const DEV_SECRET = "launch-desk-dev-secret-not-for-production";

// B4/S3: the dev/passwordless auth path is selected ONLY in explicit dev/mock
// mode (LAUNCH_DESK_MOCK=1 or NODE_ENV!=="production") — NEVER inferred from
// `hasDatabase()`. A malformed/absent DATABASE_URL in production therefore can
// NOT flip the app to passwordless login; instead the real (magic-link) config
// is used and a missing AUTH_SECRET makes Auth.js refuse to operate.
function buildConfig(): NextAuthConfig {
  const authMode = getAuthMode();
  if (authMode !== "mock") {
    // --- Production: magic-link + DB sessions --------------------------------
    // B6/S4: AUTH_SECRET MUST be present in production. We pass env.authSecret
    // verbatim (no dev fallback): Auth.js itself fails closed when it is unset,
    // so an unset secret yields no working sessions rather than a forged one.
    //
    // The Nodemailer provider is only constructed when EMAIL_SERVER is set.
    // `next build` runs with NODE_ENV=production and NO env, and Nodemailer
    // THROWS at construction without a `server` — building it unconditionally
    // would break the build at page-data collection (import time). Omitting it
    // when unconfigured keeps the build green AND is still FAIL-CLOSED at
    // runtime: with no email provider there is simply no way to sign in (the
    // dev/passwordless path is never reachable in production).
    const providers = authMode === "email"
      ? [
          Nodemailer({
            server: process.env.EMAIL_SERVER,
            from: process.env.EMAIL_FROM ?? "no-reply@launchdesk.co.za",
          }),
        ]
      : [];
    return {
      adapter: PrismaAdapter(prisma),
      secret: env.authSecret,
      session: { strategy: "database" },
      providers,
      trustHost: true,
      pages: { signIn: "/sign-in" },
    };
  }

  // --- Mock/dev mode: dev credentials, JWT session, no email/DB --------------
  return {
    secret: env.authSecret ?? DEV_SECRET,
    session: { strategy: "jwt" },
    trustHost: true,
    providers: [
      Credentials({
        id: "dev",
        name: "Dev sign-in",
        credentials: { email: { label: "Email", type: "email" } },
        // Mock mode: accept any email (or the seeded owner) with no password.
        async authorize(credentials) {
          const email =
            typeof credentials?.email === "string" && credentials.email.trim()
              ? credentials.email.trim()
              : DEV_USER_EMAIL;
          return { id: DEV_USER_ID, email, name: "Launch Desk Owner" };
        },
      }),
    ],
    pages: { signIn: "/sign-in" },
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth(buildConfig());
