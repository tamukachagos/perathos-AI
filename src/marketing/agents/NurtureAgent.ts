"use server";

// NurtureAgent — WhatsApp-based lead nurturing (Salesforce-grade).
// Follows up with new leads via WhatsApp BSP or SMS fallback.
// Moves stale contacts to 'lost' after 14 days of no response.
// Rate limit: max 50 messages per run per tenant.

import { prisma } from "@/lib/prisma";
import { getProvider as getSmsProvider } from "@/integrations/sms";
import type { AgentResult, MarketingContext } from "@/marketing/types";

const MS_DAY = 24 * 60 * 60 * 1000;
const MAX_MESSAGES_PER_RUN = 50;

/**
 * Send a WhatsApp or SMS message to a contact.
 * Prefers WhatsApp BSP (if configured via env), falls back to SMS.
 */
async function sendNurtureMessage(
  phone: string,
  message: string,
): Promise<{ sent: boolean; channel: string }> {
  // WhatsApp BSP support (placeholder — would integrate BSP SDK here)
  const whatsappBspToken = process.env.WHATSAPP_BSP_TOKEN;
  const whatsappBspPhoneId = process.env.WHATSAPP_BSP_PHONE_ID;

  if (whatsappBspToken && whatsappBspPhoneId) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/v18.0/${whatsappBspPhoneId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${whatsappBspToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: phone.replace(/\D/g, ""),
            type: "text",
            text: { body: message },
          }),
        },
      );
      if (res.ok) return { sent: true, channel: "whatsapp" };
    } catch {
      // Fall through to SMS
    }
  }

  // SMS fallback via Africa's Talking
  const sms = getSmsProvider();
  const result = await sms.sendSms(phone, message);
  const sent = result.recipients.some((r) => r.status === "Success");
  return { sent, channel: "sms" };
}

/**
 * Run the NurtureAgent for a tenant.
 */
export async function run(ctx: MarketingContext): Promise<AgentResult> {
  const actions: string[] = [];
  let tokensUsed = 0;
  let messagesSent = 0;

  try {
    // ------------------------------------------------------------------
    // Step 1: New leads older than 24h with no contact yet
    // ------------------------------------------------------------------
    const newLeads = await prisma.crmContact.findMany({
      where: {
        tenantId: ctx.tenantId,
        stage: "new",
        lastContactAt: null,
        phone: { not: null },
        createdAt: {
          lt: new Date(Date.now() - MS_DAY),
        },
      },
      take: MAX_MESSAGES_PER_RUN,
    });

    for (const contact of newLeads) {
      if (!contact.phone) continue;
      if (messagesSent >= MAX_MESSAGES_PER_RUN) break;

      const message =
        `Hi ${contact.name}! Thanks for your interest in ${ctx.businessName}. ` +
        `I'm reaching out personally — how can I help you today? ` +
        `Reply to this message or call us any time.`;

      const { sent, channel } = await sendNurtureMessage(contact.phone, message);

      if (sent) {
        await prisma.crmContact.update({
          where: { id: contact.id },
          data: {
            stage: "contacted",
            lastContactAt: new Date(),
            notes: contact.notes
              ? `${contact.notes}\n[Nurture: initial contact via ${channel}]`
              : `[Nurture: initial contact via ${channel}]`,
          },
        });
        actions.push(
          `Sent initial nurture via ${channel} to ${contact.name} (${contact.phone})`,
        );
        messagesSent++;
      }
    }

    // ------------------------------------------------------------------
    // Step 2: Contacted leads with no response in 5 days
    // ------------------------------------------------------------------
    const followUpLeads = await prisma.crmContact.findMany({
      where: {
        tenantId: ctx.tenantId,
        stage: "contacted",
        phone: { not: null },
        lastContactAt: {
          lt: new Date(Date.now() - 5 * MS_DAY),
        },
        createdAt: {
          gt: new Date(Date.now() - 14 * MS_DAY), // Not yet 14 days old
        },
      },
      take: MAX_MESSAGES_PER_RUN - messagesSent,
    });

    for (const contact of followUpLeads) {
      if (!contact.phone) continue;
      if (messagesSent >= MAX_MESSAGES_PER_RUN) break;

      const message =
        `Hi ${contact.name}, just checking in from ${ctx.businessName}. ` +
        `Did you get a chance to visit us? We'd love to see you! ` +
        `Reply "BOOK" to book, "INFO" to learn more, or "STOP" to unsubscribe.`;

      const { sent, channel } = await sendNurtureMessage(contact.phone, message);

      if (sent) {
        await prisma.crmContact.update({
          where: { id: contact.id },
          data: {
            lastContactAt: new Date(),
            notes: contact.notes
              ? `${contact.notes}\n[Nurture: follow-up via ${channel}]`
              : `[Nurture: follow-up via ${channel}]`,
          },
        });
        actions.push(
          `Sent follow-up nurture via ${channel} to ${contact.name}`,
        );
        messagesSent++;
      }
    }

    // ------------------------------------------------------------------
    // Step 3: Move unresponsive contacts to 'lost' after 14 days
    // ------------------------------------------------------------------
    const lostContacts = await prisma.crmContact.findMany({
      where: {
        tenantId: ctx.tenantId,
        stage: "contacted",
        lastContactAt: {
          lt: new Date(Date.now() - 14 * MS_DAY),
        },
      },
      take: 100,
    });

    if (lostContacts.length > 0) {
      await prisma.crmContact.updateMany({
        where: {
          tenantId: ctx.tenantId,
          id: { in: lostContacts.map((c) => c.id) },
        },
        data: { stage: "lost" },
      });
      actions.push(
        `Moved ${lostContacts.length} unresponsive contacts to 'lost' stage`,
      );
    }

    if (actions.length === 0) {
      actions.push("No leads requiring nurture at this time");
    }

    return { agentType: "nurture", success: true, actions, tokensUsed };
  } catch (error) {
    return {
      agentType: "nurture",
      success: false,
      actions,
      tokensUsed,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
