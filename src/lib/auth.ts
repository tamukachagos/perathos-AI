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
import { env, hasDatabase } from "@/lib/env";
import { prisma } from "@/lib/db/prisma/client";
import { DEV_USER_EMAIL, DEV_USER_ID } from "@/lib/db/seed";

// A stable dev secret so mock mode needs no AUTH_SECRET. Real deployments MUST
// set AUTH_SECRET; this fallback is only ever used when there is no database.
const DEV_SECRET = "launch-desk-dev-secret-not-for-production";

function buildConfig(): NextAuthConfig {
  if (hasDatabase()) {
    // --- Production / Postgres: magic-link + DB sessions ---------------------
    return {
      adapter: PrismaAdapter(prisma),
      secret: env.authSecret,
      session: { strategy: "database" },
      providers: [
        Nodemailer({
          server: process.env.EMAIL_SERVER,
          from: process.env.EMAIL_FROM ?? "no-reply@launchdesk.co.za",
        }),
      ],
      pages: { signIn: "/sign-in" },
    };
  }

  // --- Mock mode: dev credentials, JWT session, no email/DB ------------------
  return {
    secret: env.authSecret ?? DEV_SECRET,
    session: { strategy: "jwt" },
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
