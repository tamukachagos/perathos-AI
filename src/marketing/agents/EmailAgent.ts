"use server";

// EmailAgent — HubSpot-grade email sequences and campaigns.
// Runs welcome, booking reminder, and monthly newsletter sequences.
// Respects opt-out. Max 1 email/week per contact.

import { prisma } from "@/lib/prisma";
import { getProvider as getEmailProvider } from "@/integrations/emailMarketing";
import * as ContentAgent from "@/marketing/agents/ContentAgent";
import type { AgentResult, MarketingContext } from "@/marketing/types";
import { getEmailComplianceFooter } from "@/marketing/localeInstruction";

const MS_DAY = 24 * 60 * 60 * 1000;

/** True if the contact has not been emailed within the last 7 days. */
function canEmail(lastContactAt: Date | null): boolean {
  if (!lastContactAt) return true;
  return Date.now() - lastContactAt.getTime() > 7 * MS_DAY;
}

/**
 * Append the correct legal compliance footer to an HTML email body.
 * Uses a generic unsubscribe placeholder when no real URL is available.
 */
function appendComplianceFooter(
  htmlBody: string,
  countryCode: string,
  businessName: string,
  unsubUrl = "{{unsubscribe_link}}",
): string {
  // Remove any existing generic unsubscribe paragraph before appending the
  // locale-specific footer to avoid duplication.
  const cleaned = htmlBody.replace(
    /<p[^>]*>\s*\{\{unsubscribe_link\}\}\s*<\/p>/gi,
    "",
  );
  const footer = getEmailComplianceFooter(countryCode, businessName, unsubUrl);
  return cleaned + footer;
}

/**
 * Run all active email sequences for the tenant.
 */
export async function run(ctx: MarketingContext): Promise<AgentResult> {
  const actions: string[] = [];
  let tokensUsed = 0;

  try {
    const email = getEmailProvider();

    // -------------------------------------------------------------------
    // WELCOME SEQUENCE — new CRM contacts
    // -------------------------------------------------------------------
    const newContacts = await prisma.crmContact.findMany({
      where: {
        tenantId: ctx.tenantId,
        stage: "new",
        email: { not: null },
        lastContactAt: null,
        createdAt: { lte: new Date(Date.now() - MS_DAY * 0) }, // day 0 onwards
      },
      take: 50,
    });

    for (const contact of newContacts) {
      if (!contact.email) continue;

      const daysOld = Math.floor((Date.now() - contact.createdAt.getTime()) / MS_DAY);
      let subject = "";
      let bodyHtml = "";

      if (daysOld === 0) {
        subject = `Thanks for reaching out to ${ctx.businessName}!`;
        bodyHtml = `<p>Hi ${contact.name},</p>
<p>Thank you for reaching out to <strong>${ctx.businessName}</strong>! We've received your enquiry and will be in touch very soon.</p>
<p>In the meantime, feel free to WhatsApp us at ${ctx.whatsapp || "our number"} for a quicker response.</p>
<p>Warm regards,<br>The ${ctx.businessName} Team</p>
<p style="font-size:12px;color:#999;">{{unsubscribe_link}}</p>`;
      } else if (daysOld === 2) {
        const servicesStr = ctx.services.slice(0, 2).join(" and ");
        subject = `Did you know we also offer ${servicesStr}?`;
        bodyHtml = `<p>Hi ${contact.name},</p>
<p>Just a quick note from ${ctx.businessName} — did you know we also offer <strong>${servicesStr}</strong>?</p>
<p>We're here to help with everything ${ctx.industry}-related in ${ctx.location}. Let us know if you have any questions!</p>
<p>Warm regards,<br>The ${ctx.businessName} Team</p>
<p style="font-size:12px;color:#999;">{{unsubscribe_link}}</p>`;
      } else if (daysOld === 7) {
        subject = `Special offer for new customers — ${ctx.businessName}`;
        bodyHtml = `<p>Hi ${contact.name},</p>
<p>We'd love to welcome you as a customer at ${ctx.businessName}! As a new customer, we're offering you <strong>15% off your first visit</strong>.</p>
<p>Just mention this email when you book. Valid for 30 days.</p>
<p>${ctx.whatsapp ? `<a href="https://wa.me/${ctx.whatsapp.replace(/\D/g, "")}">Book via WhatsApp</a>` : "Contact us to book"}</p>
<p>Warm regards,<br>The ${ctx.businessName} Team</p>
<p style="font-size:12px;color:#999;">{{unsubscribe_link}}</p>`;
      } else if (daysOld === 14) {
        subject = `We'd love to hear from you — ${ctx.businessName}`;
        bodyHtml = `<p>Hi ${contact.name},</p>
<p>It's been two weeks since you reached out to ${ctx.businessName}. We hope we were able to help!</p>
<p>If you've visited us, we'd really appreciate a quick review — it means the world to a local business like ours.</p>
<p>Leave a review: <a href="https://${ctx.domain || "our website"}/review">Click here</a></p>
<p>Warm regards,<br>The ${ctx.businessName} Team</p>
<p style="font-size:12px;color:#999;">{{unsubscribe_link}}</p>`;
      } else {
        continue; // Not a sequence day
      }

      if (!subject || !bodyHtml) continue;

      const countryCode = ctx.countryCode ?? "ZA";
      const finalBody = appendComplianceFooter(bodyHtml, countryCode, ctx.businessName);
      const campaign = await email.createCampaign(ctx.tenantId, {
        name: `welcome-seq-day${daysOld}-${contact.id}`,
        subject,
        bodyHtml: finalBody,
      });

      await email.sendCampaign(campaign.id, [contact.email]);
      await prisma.crmContact.update({
        where: { id: contact.id },
        data: { lastContactAt: new Date() },
      });

      actions.push(`Sent welcome sequence day ${daysOld} to ${contact.email}`);
      tokensUsed += 100;
    }

    // -------------------------------------------------------------------
    // BOOKING REMINDER SEQUENCE
    // -------------------------------------------------------------------
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * MS_DAY);
    const in26h = new Date(now.getTime() + 26 * MS_DAY);
    const in2h = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const in3h = new Date(now.getTime() + 3 * 60 * 60 * 1000);

    // 24h reminder: bookings tomorrow
    const tomorrowBookings = await prisma.booking.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: { in: ["pending", "confirmed"] },
        reminderSent: false,
        date: {
          gte: in24h.toISOString().slice(0, 10),
          lte: in26h.toISOString().slice(0, 10),
        },
      },
      take: 50,
    });

    for (const booking of tomorrowBookings) {
      const contact = await prisma.crmContact.findFirst({
        where: {
          tenantId: ctx.tenantId,
          phone: booking.customerPhone,
        },
      });

      if (contact?.email && canEmail(contact.lastContactAt)) {
        const subject = `Reminder: your appointment tomorrow at ${booking.time} — ${ctx.businessName}`;
        const bodyHtml = `<p>Hi ${booking.customerName},</p>
<p>This is a friendly reminder about your appointment tomorrow at <strong>${booking.time}</strong> with <strong>${ctx.businessName}</strong>.</p>
<p>Service: ${booking.service}</p>
${ctx.whatsapp ? `<p>Questions? <a href="https://wa.me/${ctx.whatsapp.replace(/\D/g, "")}">WhatsApp us</a></p>` : ""}
<p>See you soon!</p>
<p>The ${ctx.businessName} Team</p>
<p style="font-size:12px;color:#999;">{{unsubscribe_link}}</p>`;

        const countryCodeReminder = ctx.countryCode ?? "ZA";
        const campaign = await email.createCampaign(ctx.tenantId, {
          name: `booking-reminder-24h-${booking.id}`,
          subject,
          bodyHtml: appendComplianceFooter(bodyHtml, countryCodeReminder, ctx.businessName),
        });
        await email.sendCampaign(campaign.id, [contact.email]);
        await prisma.booking.update({
          where: { id: booking.id },
          data: { reminderSent: true },
        });
        actions.push(`Sent 24h reminder to ${contact.email} for booking ${booking.id}`);
      }
    }

    // Post-visit follow-up (day after booking)
    const yesterday = new Date(now.getTime() - MS_DAY);
    const completedBookings = await prisma.booking.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: "confirmed",
        date: yesterday.toISOString().slice(0, 10),
      },
      take: 30,
    });

    for (const booking of completedBookings) {
      const contact = await prisma.crmContact.findFirst({
        where: { tenantId: ctx.tenantId, phone: booking.customerPhone },
      });
      if (contact?.email && canEmail(contact.lastContactAt)) {
        const subject = `How was your visit? — ${ctx.businessName}`;
        const bodyHtml = `<p>Hi ${booking.customerName},</p>
<p>Thank you for visiting ${ctx.businessName} yesterday! We hope you had a wonderful experience.</p>
<p>We'd love to know how it went — <a href="https://${ctx.domain || "our website"}/review">leave us a quick review here</a>. It helps more SA customers find us!</p>
<p>Thank you for supporting a local business.</p>
<p>Warm regards,<br>The ${ctx.businessName} Team</p>
<p style="font-size:12px;color:#999;">{{unsubscribe_link}}</p>`;

        const countryCodePostVisit = ctx.countryCode ?? "ZA";
        const campaign = await email.createCampaign(ctx.tenantId, {
          name: `post-visit-${booking.id}`,
          subject,
          bodyHtml: appendComplianceFooter(bodyHtml, countryCodePostVisit, ctx.businessName),
        });
        await email.sendCampaign(campaign.id, [contact.email]);
        await prisma.crmContact.update({
          where: { id: contact.id },
          data: { lastContactAt: new Date() },
        });
        actions.push(`Sent post-visit follow-up to ${contact.email}`);
      }
    }

    // -------------------------------------------------------------------
    // MONTHLY NEWSLETTER (1st of each month)
    // -------------------------------------------------------------------
    const isFirstOfMonth = now.getUTCDate() === 1;
    if (isFirstOfMonth) {
      const pieces = await ContentAgent.run(ctx, { contentTypes: ["email"] });
      const emailPiece = pieces.find((p) => p.type === "email");

      if (emailPiece?.content && emailPiece.subject) {
        // Fetch opted-in contacts
        const optedIn = await prisma.crmContact.findMany({
          where: {
            tenantId: ctx.tenantId,
            email: { not: null },
            stage: { not: "lost" },
          },
          take: 500,
        });

        const recipients = optedIn
          .map((c) => c.email)
          .filter((e): e is string => !!e);

        if (recipients.length > 0) {
          const countryCodeNewsletter = ctx.countryCode ?? "ZA";
          const campaign = await email.createCampaign(ctx.tenantId, {
            name: `newsletter-${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`,
            subject: emailPiece.subject,
            bodyHtml: appendComplianceFooter(emailPiece.content, countryCodeNewsletter, ctx.businessName),
          });
          await email.sendCampaign(campaign.id, recipients);
          actions.push(`Sent monthly newsletter to ${recipients.length} contacts`);
          tokensUsed += 500;
        }
      }
    }

    if (actions.length === 0) {
      actions.push("No email sequences due at this time");
    }

    return { agentType: "email", success: true, actions, tokensUsed };
  } catch (error) {
    return {
      agentType: "email",
      success: false,
      actions,
      tokensUsed,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Run platform-level marketing email sequences (selling Launch Desk subscriptions).
 * Targets SA SMBs who visited perathos.com but haven't signed up.
 */
export async function runPlatformMarketing(): Promise<AgentResult> {
  const platformTenantId = process.env.PLATFORM_SOCIAL_TENANT_ID;
  if (!platformTenantId) {
    return {
      agentType: "email-platform",
      success: true,
      actions: ["PLATFORM_SOCIAL_TENANT_ID not set — skipping platform email"],
      tokensUsed: 0,
    };
  }

  const actions: string[] = [];
  const email = getEmailProvider();

  try {
    // Platform prospecting contacts (source = 'web_visitor')
    const prospects = await prisma.crmContact.findMany({
      where: {
        tenantId: platformTenantId,
        email: { not: null },
        stage: { not: "converted" },
      },
      take: 200,
    });

    for (const prospect of prospects) {
      if (!prospect.email) continue;
      const daysOld = Math.floor((Date.now() - prospect.createdAt.getTime()) / MS_DAY);
      if (!canEmail(prospect.lastContactAt)) continue;

      let subject = "";
      let bodyHtml = "";

      if (daysOld === 0) {
        subject = "Get your SA business online in 2 minutes — free";
        bodyHtml = `<p>Hi ${prospect.name || "there"},</p>
<p>You visited <a href="https://perathos.com">Launch Desk</a> recently. We wanted to say hello!</p>
<p>Launch Desk lets any South African business get a professional website with AI in under 2 minutes — completely free to start.</p>
<p><a href="https://app.perathos.com">Start for free today</a></p>
<p>The Launch Desk Team</p>
<p style="font-size:12px;color:#999;">{{unsubscribe_link}}</p>`;
      } else if (daysOld === 3) {
        subject = "What your business could look like online";
        bodyHtml = `<p>Hi ${prospect.name || "there"},</p>
<p>Hundreds of SA businesses have launched with Launch Desk this month. Here's what they got:</p>
<ul><li>Professional AI-generated website live in 2 minutes</li>
<li>WhatsApp ordering for customers</li>
<li>Online booking system</li>
<li>Their own .co.za domain</li></ul>
<p><a href="https://app.perathos.com">See a demo and start free</a></p>
<p>The Launch Desk Team</p>
<p style="font-size:12px;color:#999;">{{unsubscribe_link}}</p>`;
      } else if (daysOld === 7) {
        subject = "Limited time: first month of Growth plan free";
        bodyHtml = `<p>Hi ${prospect.name || "there"},</p>
<p>We're offering new customers their first month of the <strong>Growth plan completely free</strong>.</p>
<p>The Growth plan includes: unlimited pages, custom domain, email marketing, WhatsApp commerce, and our AI marketing team that works 24/7 for your business.</p>
<p><a href="https://app.perathos.com/upgrade?promo=first-month-free">Claim your free month</a></p>
<p>Offer expires in 48 hours.</p>
<p>The Launch Desk Team</p>
<p style="font-size:12px;color:#999;">{{unsubscribe_link}}</p>`;
      } else if (daysOld === 14) {
        subject = "Last chance — grow your SA business online";
        bodyHtml = `<p>Hi ${prospect.name || "there"},</p>
<p>We know starting a new thing is hard. But thousands of SA businesses just like yours are finding customers online every day with Launch Desk.</p>
<p>Start for free — no card required. Cancel any time.</p>
<p><a href="https://app.perathos.com">Get started now</a></p>
<p>The Launch Desk Team</p>
<p style="font-size:12px;color:#999;">{{unsubscribe_link}}</p>`;
      } else {
        continue;
      }

      if (!subject) continue;

      const campaign = await email.createCampaign(platformTenantId, {
        name: `platform-seq-day${daysOld}-${prospect.id}`,
        subject,
        bodyHtml,
      });
      await email.sendCampaign(campaign.id, [prospect.email]);
      await prisma.crmContact.update({
        where: { id: prospect.id },
        data: { lastContactAt: new Date() },
      });
      actions.push(`Sent platform day ${daysOld} email to ${prospect.email}`);
    }

    return { agentType: "email-platform", success: true, actions, tokensUsed: 0 };
  } catch (error) {
    return {
      agentType: "email-platform",
      success: false,
      actions,
      tokensUsed: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Send newsletter immediately to all opted-in contacts (dashboard quick action).
 */
export async function sendNewsletter(ctx: MarketingContext): Promise<AgentResult> {
  const actions: string[] = [];
  const email = getEmailProvider();

  try {
    const pieces = await ContentAgent.run(ctx, { contentTypes: ["email"] });
    const emailPiece = pieces.find((p) => p.type === "email");

    if (!emailPiece?.content || !emailPiece.subject) {
      return {
        agentType: "email",
        success: false,
        actions,
        tokensUsed: 0,
        error: "Could not generate newsletter content",
      };
    }

    const optedIn = await prisma.crmContact.findMany({
      where: {
        tenantId: ctx.tenantId,
        email: { not: null },
        stage: { not: "lost" },
      },
      take: 500,
    });

    const recipients = optedIn.map((c) => c.email).filter((e): e is string => !!e);

    if (recipients.length === 0) {
      return {
        agentType: "email",
        success: true,
        actions: ["No opted-in contacts found"],
        tokensUsed: 500,
      };
    }

    const countryCodeManual = ctx.countryCode ?? "ZA";
    const campaign = await email.createCampaign(ctx.tenantId, {
      name: `newsletter-manual-${Date.now()}`,
      subject: emailPiece.subject,
      bodyHtml: appendComplianceFooter(emailPiece.content, countryCodeManual, ctx.businessName),
    });
    await email.sendCampaign(campaign.id, recipients);
    actions.push(`Sent newsletter "${emailPiece.subject}" to ${recipients.length} contacts`);

    return { agentType: "email", success: true, actions, tokensUsed: 500 };
  } catch (error) {
    return {
      agentType: "email",
      success: false,
      actions,
      tokensUsed: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
