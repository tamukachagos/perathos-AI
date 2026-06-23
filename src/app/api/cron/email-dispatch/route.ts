// Cron: email dispatch — runs every 5 minutes via Vercel Crons.
//
//   GET /api/cron/email-dispatch
//
// Finds all EmailCampaign records with status="scheduled" and
// scheduledAt <= now(), then dispatches each one via the emailMarketing adapter.
// Secured with CRON_SECRET (same pattern as other cron routes).

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma/client";
import { getProvider } from "@/integrations/emailMarketing";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // allow up to 60 seconds for bulk dispatch

const MAX_RECIPIENTS = 1000;

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // Find campaigns due to send
  const due = await prisma.emailCampaign.findMany({
    where: {
      status: "scheduled",
      scheduledAt: { lte: now },
    },
    take: 20, // process at most 20 per cron run to stay within timeout
  });

  if (due.length === 0) {
    return NextResponse.json({ ok: true, dispatched: 0 });
  }

  const provider = getProvider();
  const results: { campaignId: string; status: "sent" | "error"; detail: string }[] = [];

  for (const campaign of due) {
    // Mark as sending to prevent duplicate dispatch
    await prisma.emailCampaign.update({
      where: { id: campaign.id },
      data: { status: "sending" },
    });

    try {
      // Resolve recipients (all emails in CRM for this tenant)
      const emails = await resolveTenantEmails(campaign.tenantId, MAX_RECIPIENTS);

      if (emails.length === 0) {
        await prisma.emailCampaign.update({
          where: { id: campaign.id },
          data: { status: "sent", sentAt: now, recipientCount: 0 },
        });
        results.push({ campaignId: campaign.id, status: "sent", detail: "no_recipients" });
        continue;
      }

      const result = await provider.sendCampaign(campaign.id, emails);

      await prisma.emailCampaign.update({
        where: { id: campaign.id },
        data: {
          status: "sent",
          sentAt: now,
          recipientCount: emails.length,
        },
      });

      results.push({
        campaignId: campaign.id,
        status: "sent",
        detail: `sent:${result.sent} failed:${result.failed}`,
      });
    } catch (err) {
      // Roll back to scheduled so it retries next cron tick
      await prisma.emailCampaign.update({
        where: { id: campaign.id },
        data: { status: "scheduled" },
      }).catch(() => undefined);

      results.push({
        campaignId: campaign.id,
        status: "error",
        detail: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  return NextResponse.json({ ok: true, dispatched: due.length, results });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveTenantEmails(tenantId: string, limit: number): Promise<string[]> {
  const emails = new Set<string>();

  const contacts = await prisma.crmContact.findMany({
    where: { tenantId, email: { not: null } },
    select: { email: true },
    take: limit,
  });

  for (const c of contacts) {
    if (c.email) emails.add(c.email.toLowerCase());
  }

  return [...emails].slice(0, limit);
}
