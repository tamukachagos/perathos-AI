// Zero-conversation fast-lane onboarding endpoint.
//
//   POST /api/onboard/quick  — { name, industry, location, phone }
//
// Autonomous pipeline (no back-and-forth):
//   a) Build a rich description from the 4 form fields.
//   b) Call the existing profile generator (mock heuristic or real Claude) to
//      expand it with a compelling offer + services list.
//   c) Merge the user's explicit name/industry/location/phone over the result.
//   d) Check domain availability for <slug>.co.za (read-only, no wallet charge).
//   e) Return { ok, profile, suggestedDomain, available } to the client.
//
// Auth: anonymous-safe. If the caller is authenticated, the profile is stored in
// their tenant. Anonymous callers get the profile JSON for client-side state only.
// Either way the domain check is ungated + read-only.

import { NextResponse } from "next/server";
import { deriveProfile } from "@/integrations/agent/generateProfile";
import { checkAvailability } from "@/integrations/domain/service";
import type { Business } from "@/lib/types";

export const dynamic = "force-dynamic";

/** The 8 template industries — maps to the same labels used in generateProfile. */
const INDUSTRY_OFFERS: Record<string, { offer: string; services: string }> = {
  "Beauty & Wellness": {
    offer:
      "Professional beauty and wellness services in the comfort of your home or at our premises. We keep you looking and feeling your best.",
    services:
      "Massages, Facials, Nail Care, Hair Styling, Waxing, Make-up Application",
  },
  "Food & Hospitality": {
    offer:
      "Fresh, flavourful food made with care — available for dine-in, takeaway, or catering for your next event.",
    services:
      "Dine-In, Takeaway, Catering, Private Events, Custom Cakes, Meal Prep",
  },
  "Trades & Services": {
    offer:
      "Reliable tradespeople for all your home and commercial needs. We show up on time and finish the job properly.",
    services:
      "Plumbing, Electrical, Building, Painting, Waterproofing, Maintenance",
  },
  "Education & Training": {
    offer:
      "Expert tuition and skills training tailored to your goals — for individuals, groups, and corporate teams.",
    services:
      "One-on-One Tutoring, Group Classes, Online Courses, Corporate Training, Study Guides, Exam Prep",
  },
  "Cleaning Services": {
    offer:
      "Spotless results every time — residential and commercial cleaning services you can trust.",
    services:
      "Domestic Cleaning, Deep Cleans, Office Cleaning, End-of-Tenancy, Carpet & Upholstery, Laundry",
  },
  "Creative & Media": {
    offer:
      "Creative professionals helping your brand look great and reach the right people — from photography to digital marketing.",
    services:
      "Photography, Graphic Design, Social Media Management, Branding, Video Production, Copywriting",
  },
  Retail: {
    offer:
      "Quality products at great prices — shop in-store or online with fast local delivery.",
    services:
      "In-Store Shopping, Online Orders, Local Delivery, Gift Wrapping, Lay-Bye, Custom Orders",
  },
  "Professional Services": {
    offer:
      "Expert professional advice to help your business and finances run smoothly and stay compliant.",
    services:
      "Accounting, Tax Returns, Business Registration, Legal Advice, Financial Planning, Bookkeeping",
  },
};

/** Slugify a business name for domain suggestions. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

interface Body {
  name?: unknown;
  industry?: unknown;
  location?: unknown;
  phone?: unknown;
}

export async function POST(request: Request) {
  // Geo-detection headers (set by middleware or CDN/edge layer)
  const locale      = request.headers.get("x-detected-locale")   ?? "en";
  const currency    = request.headers.get("x-detected-currency") ?? "USD";
  const region      = request.headers.get("x-detected-region")   ?? "us-east";
  const countryCode = request.headers.get("x-detected-country")  ?? "US";
  const timezone    = request.headers.get("x-detected-timezone") ?? "UTC";

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const name =
    typeof body.name === "string" ? body.name.trim() : "";
  const industry =
    typeof body.industry === "string" ? body.industry.trim() : "";
  const location =
    typeof body.location === "string" ? body.location.trim() : "";
  const phone =
    typeof body.phone === "string" ? body.phone.trim() : "";

  if (!name) {
    return NextResponse.json(
      { ok: false, error: "Business name is required." },
      { status: 400 },
    );
  }

  // Step (a): Build a rich synthetic description to feed through the existing
  // profile generator. This lets the same AI/heuristic enrichment path produce
  // a compelling offer and services list from just the 4 form fields.
  const industryPhrase = industry && industry !== "Other" ? industry : "services";
  const locationPhrase = location ? ` based in ${location}` : "";
  const phonePhrase = phone ? ` Contact: ${phone}.` : "";
  const syntheticDescription = [
    `"${name}" is a ${industryPhrase} business${locationPhrase}.`,
    industry && industry !== "Other"
      ? `They provide ${industryPhrase.toLowerCase()} services to local customers.`
      : "",
    phonePhrase,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  // Build an optional language instruction for non-English locales.
  const langInstruction = locale !== "en"
    ? ` Generate the business offer and services in ${locale} language, culturally appropriate for ${countryCode}.`
    : "";

  // Step (b): Run through the existing profile generator (deterministic heuristic
  // with no API key required; Claude is used automatically when the key is set).
  const { profile: derived } = deriveProfile(syntheticDescription + langInstruction);

  // Step (c): Look up a template-specific offer + services for the chosen
  // industry, then merge the user's explicit field values over everything.
  const template =
    industry && industry !== "Other"
      ? (INDUSTRY_OFFERS[industry] ?? null)
      : null;

  const profile: Business = {
    name,
    industry: industry || derived.industry,
    location: location || derived.location,
    offer:
      template?.offer ??
      derived.offer ??
      `${name} — professional services in ${location || "South Africa"}.`,
    services:
      template?.services ?? derived.services,
    tone: derived.tone || "Warm and professional",
    whatsapp: phone,
    domain: "",
    email: "",
  };

  // Step (d): Check domain availability for <slug>.co.za (read-only, no charge).
  const slug = slugify(name);
  const suggestedDomain = slug ? `${slug}.co.za` : null;
  let available: boolean | null = null;
  if (suggestedDomain) {
    try {
      const domainResult = await checkAvailability(suggestedDomain);
      available = domainResult.ok ? domainResult.quote.available : null;
    } catch {
      // Domain check is best-effort; never fail the whole pipeline for it.
      available = null;
    }
  }

  // Step (e): Return the profile + domain suggestion + detected geo data.
  // Auth-aware persistence (storing to the tenant's DB) is handled client-side
  // after onApplyProfile() calls the existing profile-save flow; this endpoint
  // stays stateless so it is safe for anonymous users too.
  return NextResponse.json({
    ok: true,
    profile,
    suggestedDomain,
    available,
    locale,
    currency,
    region,
    countryCode,
    timezone,
  });
}
