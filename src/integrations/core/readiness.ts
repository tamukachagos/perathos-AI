// The pure readiness-evaluation functions, ported VERBATIM from the prototype's
// adapter `evaluate(business)` bodies in src/adapters.js. One named function per
// capability so both the nine ProviderAdapters and the dashboard checklist can
// share the exact same logic with no behavioural drift.

import type { AdapterReadiness, Business } from "@/lib/types";
import { isFilled, isValidEmail, isValidWhatsapp } from "@/lib/format";
import { STATUS } from "./types";

export function evaluateProfile(business: Business): AdapterReadiness {
  const required: (keyof Business)[] = ["name", "industry", "location", "offer"];
  const missing = required.filter((field) => !isFilled(business[field]));
  return missing.length === 0
    ? { status: STATUS.READY, detail: "Identity, services, and trust copy are structured." }
    : { status: STATUS.PENDING, detail: `Add ${missing.join(", ")} to complete the profile.` };
}

export function evaluateSite(business: Business): AdapterReadiness {
  return isFilled(business.name) && isFilled(business.offer)
    ? { status: STATUS.READY, detail: "Lightweight, mobile-first site generated from your profile." }
    : { status: STATUS.PENDING, detail: "Complete the profile to generate the site draft." };
}

export function evaluateDomain(business: Business): AdapterReadiness {
  if (!isFilled(business.domain)) {
    return { status: STATUS.PENDING, detail: "Choose a .co.za domain to check availability." };
  }
  return {
    status: STATUS.REVIEW,
    detail: `${business.domain} is available; registrant ownership needs your approval before purchase.`,
  };
}

export function evaluateWhatsapp(business: Business): AdapterReadiness {
  return isValidWhatsapp(business.whatsapp)
    ? { status: STATUS.READY, detail: "Click-to-chat is live now — no WhatsApp API account needed." }
    : { status: STATUS.PENDING, detail: "Add a valid SA mobile number to enable click-to-chat." };
}

export function evaluatePayments(): AdapterReadiness {
  return {
    status: STATUS.REVIEW,
    detail: "Hosted ZAR payment links keep PCI scope low; connecting a payout account needs approval.",
  };
}

export function evaluateEmail(business: Business): AdapterReadiness {
  if (!isFilled(business.domain)) {
    return { status: STATUS.PENDING, detail: "A domain is needed before email can be staged." };
  }
  if (!isValidEmail(business.email)) {
    return { status: STATUS.PENDING, detail: "Add a valid business email address to stage mailboxes." };
  }
  return { status: STATUS.REVIEW, detail: "MX, SPF, DKIM, and DMARC are staged behind DNS approval." };
}

export function evaluateGithub(): AdapterReadiness {
  return { status: STATUS.READY, detail: "Every publish is versioned, so changes can be rolled back safely." };
}

export function evaluateAnalytics(): AdapterReadiness {
  return { status: STATUS.READY, detail: "Visits, leads, WhatsApp clicks, and payment clicks are tracked." };
}

// DNS readiness mirrors the prototype's combined "Domain & DNS" gate: once a
// domain is chosen, DNS records (delegation, A/AAAA/CNAME) wait behind approval.
export function evaluateDns(business: Business): AdapterReadiness {
  if (!isFilled(business.domain)) {
    return { status: STATUS.PENDING, detail: "DNS is staged once a domain is chosen." };
  }
  return {
    status: STATUS.REVIEW,
    detail: "DNS records (delegation, A/AAAA, CNAME) are staged and need your approval before they go live.",
  };
}
