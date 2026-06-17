// Postgres seed script. Runs ONLY against a real database (DATABASE_URL set);
// it is a no-op in mock mode, where the in-memory repository seeds itself.
//
// Seeds a dev tenant + owner user + the Maboneng sample business and its first
// published site version, so a freshly-migrated DB matches the mock experience.
// Run with: npm run db:seed   (after `prisma migrate deploy`).

import { PrismaClient } from "@prisma/client";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
if (!DATABASE_URL || DATABASE_URL === "postgresql://placeholder") {
  console.log("[seed] No real DATABASE_URL — skipping (mock mode seeds itself).");
  process.exit(0);
}

const prisma = new PrismaClient();

const MABONENG = {
  name: "Maboneng Mobile Spa",
  industry: "Beauty and wellness",
  location: "Johannesburg, Gauteng",
  whatsapp: "+27 82 555 0198",
  domainName: "mabonengspa.co.za",
  email: "hello@mabonengspa.co.za",
  tone: "Friendly, premium, local",
  offer: "Mobile massage, nails, and beauty treatments at your home or office.",
  services:
    "Swedish massage, gel nails, bridal packages, corporate wellness days",
};

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "owner@example.com" },
    update: {},
    create: { email: "owner@example.com", name: "Launch Desk Owner" },
  });

  const tenant = await prisma.tenant.upsert({
    where: { slug: "maboneng" },
    update: {},
    create: {
      name: "Maboneng",
      slug: "maboneng",
      memberships: { create: { userId: user.id, role: "owner" } },
    },
  });

  const business = await prisma.business.create({
    data: { tenantId: tenant.id, ...MABONENG },
  });

  console.log(
    `[seed] tenant=${tenant.id} user=${user.id} business=${business.id}`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
