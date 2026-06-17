// Auth.js v5 catch-all route handler. Serves sign-in, callback, session, and
// sign-out. Works in both mock mode (dev credentials) and Postgres mode
// (magic-link) with no change here.

import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
