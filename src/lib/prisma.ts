// Convenience re-export of the Prisma client singleton.
// This module is server-only — never import it in client components.
// The actual client is in @/lib/db/prisma/client and is lazily instantiated
// only when DATABASE_URL is set to a real Postgres URL.

export { prisma } from "@/lib/db/prisma/client";
