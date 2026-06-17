import {
  BarChart3,
  CheckCircle2,
  CircleDollarSign,
  Cloud,
  Code2,
  Globe2,
  Mail,
  MessageCircle,
} from 'lucide-react'
import { isFilled, isValidEmail, isValidWhatsapp } from './format'

// Status vocabulary shared across the platform.
export const STATUS = {
  READY: 'ready', // automated and good to go
  REVIEW: 'review', // works, but a risky action needs owner approval first
  PENDING: 'pending', // needs more input or a guided setup step
}

/**
 * Provider-adapter contract.
 *
 * Every launch capability is modelled as an adapter so the simulated MVP can be
 * swapped for a real vendor integration without touching the UI. A real adapter
 * (Paystack, Cloudflare, Meta/BSP, domains.co.za, …) would implement the same
 * shape, replacing the synchronous `evaluate` with an async `check(business)`
 * that calls the provider and returns the same { status, detail } result.
 *
 * @typedef {Object} ProviderAdapter
 * @property {string}   key            Stable id used for routing/selection.
 * @property {string}   title          Human label for the checklist row.
 * @property {string}   provider       The vendor/interface this maps to.
 * @property {string}   interfaceName  The provider-adapter interface it satisfies.
 * @property {boolean}  approvalGated   True if its primary action needs sign-off.
 * @property {boolean}  simulated      True until a real integration is wired in.
 * @property {Function} icon           lucide-react icon component.
 * @property {(business: object) => { status: string, detail: string }} evaluate
 */

/** @type {ProviderAdapter[]} */
export const launchAdapters = [
  {
    key: 'profile',
    title: 'Business Profile',
    provider: 'Launch Desk',
    interfaceName: 'AgentProvider',
    approvalGated: false,
    simulated: true,
    icon: CheckCircle2,
    evaluate(business) {
      const required = ['name', 'industry', 'location', 'offer']
      const missing = required.filter((field) => !isFilled(business[field]))
      return missing.length === 0
        ? { status: STATUS.READY, detail: 'Identity, services, and trust copy are structured.' }
        : { status: STATUS.PENDING, detail: `Add ${missing.join(', ')} to complete the profile.` }
    },
  },
  {
    key: 'site',
    title: 'Website',
    provider: 'Hosting adapter (Vercel/SA)',
    interfaceName: 'HostingProvider',
    approvalGated: false,
    simulated: true,
    icon: Cloud,
    evaluate(business) {
      return isFilled(business.name) && isFilled(business.offer)
        ? { status: STATUS.READY, detail: 'Lightweight, mobile-first site generated from your profile.' }
        : { status: STATUS.PENDING, detail: 'Complete the profile to generate the site draft.' }
    },
  },
  {
    key: 'domain',
    title: 'Domain & DNS',
    provider: 'domains.co.za + Cloudflare',
    interfaceName: 'DomainProvider',
    approvalGated: true,
    simulated: true,
    icon: Globe2,
    evaluate(business) {
      if (!isFilled(business.domain)) {
        return { status: STATUS.PENDING, detail: 'Choose a .co.za domain to check availability.' }
      }
      return {
        status: STATUS.REVIEW,
        detail: `${business.domain} is available; registrant ownership needs your approval before purchase.`,
      }
    },
  },
  {
    key: 'whatsapp',
    title: 'Connect WhatsApp',
    provider: 'Click-to-chat (Meta/BSP later)',
    interfaceName: 'MessagingProvider',
    approvalGated: false,
    simulated: true,
    icon: MessageCircle,
    evaluate(business) {
      return isValidWhatsapp(business.whatsapp)
        ? { status: STATUS.READY, detail: 'Click-to-chat is live now — no WhatsApp API account needed.' }
        : { status: STATUS.PENDING, detail: 'Add a valid SA mobile number to enable click-to-chat.' }
    },
  },
  {
    key: 'payments',
    title: 'Payment Links',
    provider: 'Paystack / Yoco / PayFast',
    interfaceName: 'PaymentProvider',
    approvalGated: true,
    simulated: true,
    icon: CircleDollarSign,
    evaluate() {
      return {
        status: STATUS.REVIEW,
        detail: 'Hosted ZAR payment links keep PCI scope low; connecting a payout account needs approval.',
      }
    },
  },
  {
    key: 'email',
    title: 'Business Email',
    provider: 'Zoho / Google adapter',
    interfaceName: 'EmailProvider',
    approvalGated: true,
    simulated: true,
    icon: Mail,
    evaluate(business) {
      if (!isFilled(business.domain)) {
        return { status: STATUS.PENDING, detail: 'A domain is needed before email can be staged.' }
      }
      if (!isValidEmail(business.email)) {
        return { status: STATUS.PENDING, detail: 'Add a valid business email address to stage mailboxes.' }
      }
      return { status: STATUS.REVIEW, detail: 'MX, SPF, DKIM, and DMARC are staged behind DNS approval.' }
    },
  },
  {
    key: 'github',
    title: 'Version History',
    provider: 'GitHub App',
    interfaceName: 'GitHubProvider',
    approvalGated: false,
    simulated: true,
    icon: Code2,
    evaluate() {
      return { status: STATUS.READY, detail: 'Every publish is versioned, so changes can be rolled back safely.' }
    },
  },
  {
    key: 'analytics',
    title: 'Analytics',
    provider: 'PostHog + GA4',
    interfaceName: 'AnalyticsProvider',
    approvalGated: false,
    simulated: true,
    icon: BarChart3,
    evaluate() {
      return { status: STATUS.READY, detail: 'Visits, leads, WhatsApp clicks, and payment clicks are tracked.' }
    },
  },
]

// Run every adapter against the current business to derive live statuses.
export function evaluateAdapters(business) {
  return launchAdapters.map((adapter) => ({
    ...adapter,
    ...adapter.evaluate(business),
  }))
}

// Readiness is real: the share of capabilities that are fully automated (READY).
// REVIEW items are intentionally not counted — they await human approval.
export function readinessScore(business) {
  const evaluated = evaluateAdapters(business)
  const ready = evaluated.filter((item) => item.status === STATUS.READY).length
  return Math.round((ready / evaluated.length) * 100)
}
