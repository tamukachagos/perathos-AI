import type { Business } from "./types";

export interface SiteTemplate {
  id: string;
  emoji: string;
  label: string;
  business: Business;
}

export const SITE_TEMPLATES: SiteTemplate[] = [
  {
    id: "hair-salon",
    emoji: "✂️",
    label: "Hair Salon",
    business: {
      name: "My Hair Salon",
      industry: "Beauty & Hair",
      location: "Johannesburg, Gauteng",
      whatsapp: "",
      domain: "",
      email: "",
      tone: "Warm, professional, welcoming",
      offer: "Professional hair styling, cuts, colour, and treatments for men, women, and children.",
      services: "Haircuts, blow-dry, colour & highlights, braids, relaxers, treatments, children's cuts",
    },
  },
  {
    id: "restaurant",
    emoji: "🍽️",
    label: "Restaurant",
    business: {
      name: "My Restaurant",
      industry: "Food & Beverage",
      location: "Cape Town, Western Cape",
      whatsapp: "",
      domain: "",
      email: "",
      tone: "Inviting, fresh, community-focused",
      offer: "Freshly cooked meals, family dining, and takeaway — good food at fair prices.",
      services: "Dine-in, takeaway, catering, private events, daily specials, delivery",
    },
  },
  {
    id: "cleaning",
    emoji: "🧹",
    label: "Cleaning Service",
    business: {
      name: "My Cleaning Service",
      industry: "Home & Office Services",
      location: "Pretoria, Gauteng",
      whatsapp: "",
      domain: "",
      email: "",
      tone: "Reliable, trustworthy, efficient",
      offer: "Professional home and office cleaning — we show up on time and leave your space spotless.",
      services: "Domestic cleaning, deep clean, office cleaning, end-of-lease clean, once-off & recurring",
    },
  },
  {
    id: "consultancy",
    emoji: "💼",
    label: "Consultancy",
    business: {
      name: "My Consulting Practice",
      industry: "Professional Services",
      location: "Sandton, Gauteng",
      whatsapp: "",
      domain: "",
      email: "",
      tone: "Expert, confident, results-focused",
      offer: "Practical consulting to help businesses solve real problems and grow sustainably.",
      services: "Business strategy, operations, financial planning, compliance, executive coaching",
    },
  },
  {
    id: "fitness",
    emoji: "💪",
    label: "Fitness Trainer",
    business: {
      name: "My Fitness Studio",
      industry: "Health & Fitness",
      location: "Durban, KwaZulu-Natal",
      whatsapp: "",
      domain: "",
      email: "",
      tone: "Energetic, motivating, supportive",
      offer: "Personal training and group fitness to help you reach your goals — wherever you are.",
      services: "Personal training, group classes, home visits, nutrition coaching, weight loss, strength training",
    },
  },
  {
    id: "retail",
    emoji: "👗",
    label: "Clothing / Retail",
    business: {
      name: "My Fashion Store",
      industry: "Retail · Fashion",
      location: "Johannesburg, Gauteng",
      whatsapp: "",
      domain: "",
      email: "",
      tone: "Stylish, accessible, on-trend",
      offer: "Affordable fashion for every occasion — from everyday wear to special events.",
      services: "Women's wear, men's wear, accessories, occasion wear, plus sizes, school uniforms",
    },
  },
  {
    id: "trades",
    emoji: "🔧",
    label: "Trades & Repairs",
    business: {
      name: "My Trade Business",
      industry: "Trades & Repairs",
      location: "East Rand, Gauteng",
      whatsapp: "",
      domain: "",
      email: "",
      tone: "Reliable, no-nonsense, honest",
      offer: "Fast, quality plumbing, electrical, and general repairs — call us and we show up.",
      services: "Plumbing, geyser installation, electrical work, leak fixing, tiling, painting, carpentry",
    },
  },
  {
    id: "education",
    emoji: "📚",
    label: "Tutoring / Educare",
    business: {
      name: "My Tutoring Centre",
      industry: "Education",
      location: "Soweto, Gauteng",
      whatsapp: "",
      domain: "",
      email: "",
      tone: "Encouraging, nurturing, expert",
      offer: "Quality tutoring and academic support for learners from Grade R to matric.",
      services: "Maths tutoring, English, Science, exam prep, after-school care, holiday classes",
    },
  },
];
