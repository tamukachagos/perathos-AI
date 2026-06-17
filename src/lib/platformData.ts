import {
  BarChart3,
  Bot,
  CheckCircle2,
  CircleDollarSign,
  Cloud,
  Globe2,
  Inbox,
  Megaphone,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { Business } from "./types";

export const initialBusiness: Business = {
  name: "Maboneng Mobile Spa",
  industry: "Beauty and wellness",
  location: "Johannesburg, Gauteng",
  whatsapp: "+27 82 555 0198",
  domain: "mabonengspa.co.za",
  email: "hello@mabonengspa.co.za",
  tone: "Friendly, premium, local",
  offer: "Mobile massage, nails, and beauty treatments at your home or office.",
  services: "Swedish massage, gel nails, bridal packages, corporate wellness days",
};

export interface AnalyticsItem {
  label: string;
  value: string;
  change: string;
  tone: "blue" | "green" | "gold" | "slate";
}

export const analytics: AnalyticsItem[] = [
  { label: "Visits", value: "1,284", change: "+18%", tone: "blue" },
  { label: "WhatsApp clicks", value: "214", change: "+31%", tone: "green" },
  { label: "Leads", value: "67", change: "+12%", tone: "gold" },
  { label: "Payment clicks", value: "29", change: "+9%", tone: "slate" },
];

export interface AgentTeamMember {
  title: string;
  icon: LucideIcon;
  body: string;
}

export const agentTeam: AgentTeamMember[] = [
  {
    title: "Launch Agent",
    icon: Sparkles,
    body: "Turns a plain-language intake into structured business data and a publish-ready site.",
  },
  {
    title: "Compliance Agent",
    icon: ShieldCheck,
    body: "Checks POPIA consent, risky changes, audit logs, and approval requirements.",
  },
  {
    title: "Growth Agent",
    icon: Megaphone,
    body: "Suggests service pages, Google Business Profile updates, and campaign copy.",
  },
  {
    title: "Support Agent",
    icon: Inbox,
    body: "Turns provider failures and customer confusion into guided next actions.",
  },
];

export const providerAdapters: string[] = [
  "DomainProvider",
  "DnsProvider",
  "HostingProvider",
  "GitHubProvider",
  "EmailProvider",
  "MessagingProvider",
  "PaymentProvider",
  "AnalyticsProvider",
  "AgentProvider",
];

export const activityFeed: string[] = [
  "AI generated homepage copy and FAQs from the business profile.",
  "Website preview rebuilt from structured services and location data.",
  "Domain registration marked for human approval before purchase.",
  "Payment link fields validated without touching card data.",
];

export interface NavItem {
  label: string;
  icon: LucideIcon;
}

export const navItems: NavItem[] = [
  { label: "Launch Desk", icon: Sparkles },
  { label: "Business Profile", icon: CheckCircle2 },
  { label: "Site Preview", icon: Cloud },
  { label: "Connect WhatsApp", icon: MessageCircle },
  { label: "Payment Links", icon: CircleDollarSign },
  { label: "Domain & Email", icon: Globe2 },
  { label: "Analytics", icon: BarChart3 },
  { label: "AI Updates", icon: Bot },
];
