import {
  BarChart3,
  Bot,
  CheckCircle2,
  CircleDollarSign,
  Cloud,
  Code2,
  Globe2,
  Inbox,
  Mail,
  Megaphone,
  MessageCircle,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'

export const initialBusiness = {
  name: 'Maboneng Mobile Spa',
  industry: 'Beauty and wellness',
  location: 'Johannesburg, Gauteng',
  whatsapp: '+27 82 555 0198',
  domain: 'mabonengspa.co.za',
  email: 'hello@mabonengspa.co.za',
  tone: 'Friendly, premium, local',
  offer: 'Mobile massage, nails, and beauty treatments at your home or office.',
  services: 'Swedish massage, gel nails, bridal packages, corporate wellness days',
}

export const launchSteps = [
  {
    id: 'profile',
    title: 'Business Profile',
    provider: 'Launch Desk',
    status: 'ready',
    icon: CheckCircle2,
    detail: 'Business identity, services, hours, and trust copy are structured.',
  },
  {
    id: 'site',
    title: 'Website',
    provider: 'Vercel adapter',
    status: 'ready',
    icon: Cloud,
    detail: 'Static site generated from the business profile with rollback.',
  },
  {
    id: 'domain',
    title: 'Domain & DNS',
    provider: 'Domains.co.za + Cloudflare',
    status: 'review',
    icon: Globe2,
    detail: '.co.za availability checked; registrant ownership needs approval.',
  },
  {
    id: 'whatsapp',
    title: 'Connect WhatsApp',
    provider: 'Meta/BSP adapter',
    status: 'pending',
    icon: MessageCircle,
    detail: 'Click-to-chat works now; API onboarding can be added on Growth.',
  },
  {
    id: 'payments',
    title: 'Payment Links',
    provider: 'Paystack/Yoco/PayFast',
    status: 'ready',
    icon: CircleDollarSign,
    detail: 'Hosted payment links keep PCI scope low for the first release.',
  },
  {
    id: 'email',
    title: 'Business Email',
    provider: 'Zoho/Google adapter',
    status: 'review',
    icon: Mail,
    detail: 'MX, SPF, DKIM, and DMARC are staged behind DNS approval.',
  },
  {
    id: 'github',
    title: 'GitHub Versioning',
    provider: 'GitHub App',
    status: 'ready',
    icon: Code2,
    detail: 'Repo, commits, and rollback are hidden unless advanced mode is on.',
  },
  {
    id: 'analytics',
    title: 'Analytics',
    provider: 'PostHog + GA4',
    status: 'ready',
    icon: BarChart3,
    detail: 'Visits, leads, WhatsApp clicks, and payment clicks are tracked.',
  },
]

export const analytics = [
  { label: 'Visits', value: '1,284', change: '+18%', tone: 'blue' },
  { label: 'WhatsApp clicks', value: '214', change: '+31%', tone: 'green' },
  { label: 'Leads', value: '67', change: '+12%', tone: 'gold' },
  { label: 'Payment clicks', value: '29', change: '+9%', tone: 'slate' },
]

export const agentTeam = [
  {
    title: 'Launch Agent',
    icon: Sparkles,
    body: 'Turns a plain-language intake into structured business data and a publish-ready site.',
  },
  {
    title: 'Compliance Agent',
    icon: ShieldCheck,
    body: 'Checks POPIA consent, risky changes, audit logs, and approval requirements.',
  },
  {
    title: 'Growth Agent',
    icon: Megaphone,
    body: 'Suggests service pages, Google Business Profile updates, and campaign copy.',
  },
  {
    title: 'Support Agent',
    icon: Inbox,
    body: 'Turns provider failures and customer confusion into guided next actions.',
  },
]

export const providerAdapters = [
  'DomainProvider',
  'DnsProvider',
  'HostingProvider',
  'GitHubProvider',
  'EmailProvider',
  'MessagingProvider',
  'PaymentProvider',
  'AnalyticsProvider',
  'AgentProvider',
]

export const activityFeed = [
  'AI generated homepage copy and FAQs from the business profile.',
  'Website preview rebuilt from structured services and location data.',
  'Domain registration marked for human approval before purchase.',
  'Payment link fields validated without touching card data.',
]

export const navItems = [
  { label: 'Launch Desk', icon: Sparkles },
  { label: 'Business Profile', icon: CheckCircle2 },
  { label: 'Site Preview', icon: Cloud },
  { label: 'Connect WhatsApp', icon: MessageCircle },
  { label: 'Payment Links', icon: CircleDollarSign },
  { label: 'Domain & Email', icon: Globe2 },
  { label: 'Analytics', icon: BarChart3 },
  { label: 'AI Updates', icon: Bot },
]
