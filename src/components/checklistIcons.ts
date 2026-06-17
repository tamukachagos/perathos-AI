import {
  BarChart3,
  CheckCircle2,
  CircleDollarSign,
  Cloud,
  Code2,
  Globe2,
  Mail,
  MessageCircle,
  type LucideIcon,
} from "lucide-react";

// Icons for the launch-checklist rows, keyed by the checklist adapter `key`.
// Kept out of the (server-safe) registry so adapter data stays icon-free.
export const checklistIcons: Record<string, LucideIcon> = {
  profile: CheckCircle2,
  site: Cloud,
  domain: Globe2,
  whatsapp: MessageCircle,
  payments: CircleDollarSign,
  email: Mail,
  github: Code2,
  analytics: BarChart3,
};
