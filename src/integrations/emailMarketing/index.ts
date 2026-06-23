"use server";

// Email marketing adapter — campaign creation and sending via Resend.
// Gated on RESEND_API_KEY; falls back to mock (console logging) when absent.
// Campaigns are tracked in the EmailCampaign Prisma model.

import { prisma } from "@/lib/prisma";

const RESEND_FROM = "no-reply@perathos.com";
const RESEND_EMAILS_URL = "https://api.resend.com/emails";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CampaignData {
  name: string;
  subject: string;
  bodyHtml: string;
  scheduledAt?: Date;
}

export interface CampaignRecord {
  id: string;
  tenantId: string;
  name: string;
  subject: string;
  bodyHtml: string;
  status: string;
  scheduledAt?: Date | null;
  sentAt?: Date | null;
  recipientCount: number;
  openCount: number;
  clickCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SendResult {
  sent: number;
  failed: number;
  ids: string[];
}

export interface EmailMarketingProvider {
  createCampaign(tenantId: string, data: CampaignData): Promise<CampaignRecord>;
  sendCampaign(campaignId: string, recipients: string[]): Promise<SendResult>;
  trackOpen(campaignId: string): Promise<CampaignRecord>;
  trackClick(campaignId: string): Promise<CampaignRecord>;
}

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

export function createMockAdapter(): EmailMarketingProvider {
  const store = new Map<string, CampaignRecord>();

  return {
    async createCampaign(tenantId, data) {
      const record: CampaignRecord = {
        id: `mock-campaign-${Date.now()}`,
        tenantId,
        name: data.name,
        subject: data.subject,
        bodyHtml: data.bodyHtml,
        status: "draft",
        scheduledAt: data.scheduledAt ?? null,
        sentAt: null,
        recipientCount: 0,
        openCount: 0,
        clickCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.set(record.id, record);
      console.log("[mock:emailMarketing] createCampaign", record.name);
      return record;
    },

    async sendCampaign(campaignId, recipients) {
      const campaign = store.get(campaignId);
      if (!campaign) throw new Error(`[mock:emailMarketing] Campaign ${campaignId} not found`);
      const ids = recipients.map((_, i) => `mock-email-${campaignId}-${i}`);
      console.log(`[mock:emailMarketing] sendCampaign "${campaign.subject}" → ${recipients.length} recipients`);
      const updated = {
        ...campaign,
        status: "sent",
        sentAt: new Date(),
        recipientCount: recipients.length,
        updatedAt: new Date(),
      };
      store.set(campaignId, updated);
      return { sent: recipients.length, failed: 0, ids };
    },

    async trackOpen(campaignId) {
      const campaign = store.get(campaignId);
      if (!campaign) throw new Error(`[mock:emailMarketing] Campaign ${campaignId} not found`);
      const updated = { ...campaign, openCount: campaign.openCount + 1, updatedAt: new Date() };
      store.set(campaignId, updated);
      return updated;
    },

    async trackClick(campaignId) {
      const campaign = store.get(campaignId);
      if (!campaign) throw new Error(`[mock:emailMarketing] Campaign ${campaignId} not found`);
      const updated = { ...campaign, clickCount: campaign.clickCount + 1, updatedAt: new Date() };
      store.set(campaignId, updated);
      return updated;
    },
  };
}

// ---------------------------------------------------------------------------
// Real adapter — Resend API
// ---------------------------------------------------------------------------

export function createRealAdapter(): EmailMarketingProvider {
  const apiKey = process.env.RESEND_API_KEY!;

  return {
    async createCampaign(tenantId, data) {
      return prisma.emailCampaign.create({
        data: {
          tenantId,
          name: data.name,
          subject: data.subject,
          bodyHtml: data.bodyHtml,
          scheduledAt: data.scheduledAt,
        },
      }) as unknown as CampaignRecord;
    },

    async sendCampaign(campaignId, recipients) {
      const campaign = await prisma.emailCampaign.findUniqueOrThrow({
        where: { id: campaignId },
      });

      const results = await Promise.allSettled(
        recipients.map((to) =>
          fetch(RESEND_EMAILS_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: RESEND_FROM,
              to,
              subject: campaign.subject,
              html: campaign.bodyHtml,
            }),
          }).then((r) => r.json() as Promise<{ id?: string }>),
        ),
      );

      const ids: string[] = [];
      let failed = 0;
      for (const r of results) {
        if (r.status === "fulfilled" && r.value.id) {
          ids.push(r.value.id);
        } else {
          failed++;
        }
      }

      await prisma.emailCampaign.update({
        where: { id: campaignId },
        data: {
          status: "sent",
          sentAt: new Date(),
          recipientCount: recipients.length,
        },
      });

      return { sent: ids.length, failed, ids };
    },

    async trackOpen(campaignId) {
      return prisma.emailCampaign.update({
        where: { id: campaignId },
        data: { openCount: { increment: 1 } },
      }) as unknown as CampaignRecord;
    },

    async trackClick(campaignId) {
      return prisma.emailCampaign.update({
        where: { id: campaignId },
        data: { clickCount: { increment: 1 } },
      }) as unknown as CampaignRecord;
    },
  };
}

// ---------------------------------------------------------------------------
// Readiness + public surface
// ---------------------------------------------------------------------------

export function isConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export function getProvider(): EmailMarketingProvider {
  if (isConfigured()) {
    return createRealAdapter();
  }
  return createMockAdapter();
}
