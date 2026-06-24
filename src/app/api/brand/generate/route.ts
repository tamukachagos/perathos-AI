// Brand logo generation endpoint.
//
//   POST /api/brand/generate
//   Body: { tenantId, businessName, industry, style: "modern"|"classic"|"bold"|"minimal" }
//
// Calls the OpenRouter image generation API (Flux Schnell) to produce 3 logo
// options. Stores the first result as the selected logoUrl on the tenant's
// BrandKit row (upserted). Falls back to a placeholder SVG data-URL if the
// OpenRouter call fails so the UI always has something to show.
//
// Auth required — tenant is resolved from the session, not the body.

import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/authz";
import { prisma } from "@/lib/db/prisma/client";

export const dynamic = "force-dynamic";

// --- Prompt templates ---------------------------------------------------------

const STYLE_PROMPTS: Record<string, (name: string, industry: string) => string> = {
  modern: (name, industry) =>
    `Minimalist vector logo for ${name}, ${industry} business, flat design, blue and white, professional, no text, SVG-style icon`,
  classic: (name, industry) =>
    `Elegant logo emblem for ${name} ${industry}, gold and navy, traditional, professional crest`,
  bold: (name, industry) =>
    `Bold geometric logo for ${name} ${industry}, vibrant colors, strong shapes, dynamic`,
  minimal: (name, industry) =>
    `Ultra-minimal wordmark-style logo, ${name}, ${industry}, single color, clean`,
};

// --- Placeholder fallback -----------------------------------------------------

/** Returns a simple SVG data-URL so the UI is never empty. */
function placeholderSvg(label: string): string {
  const initials = label
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
  <rect width="120" height="120" rx="20" fill="#123a6f"/>
  <text x="60" y="78" font-family="system-ui,sans-serif" font-size="44" font-weight="800" fill="#ffffff" text-anchor="middle">${initials}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

// --- Request body interface ---------------------------------------------------

interface Body {
  businessName?: unknown;
  industry?: unknown;
  style?: unknown;
}

// --- Handler ------------------------------------------------------------------

export async function POST(request: Request) {
  // 1. Auth
  let ctx;
  try {
    ctx = await requireTenant();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // 2. Parse body
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const businessName =
    typeof body.businessName === "string" ? body.businessName.trim() : "";
  const industry =
    typeof body.industry === "string" ? body.industry.trim() : "business";
  const style =
    typeof body.style === "string" && body.style in STYLE_PROMPTS
      ? body.style
      : "modern";

  if (!businessName) {
    return NextResponse.json(
      { ok: false, error: "missing_business_name" },
      { status: 400 },
    );
  }

  const promptFn = STYLE_PROMPTS[style];
  const prompt = promptFn(businessName, industry);

  // 3. Call OpenRouter image generation
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  let logos: string[] = [];

  if (apiKey) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "black-forest-labs/flux-schnell",
          prompt,
          n: 3,
          size: "512x512",
        }),
      });

      if (res.ok) {
        interface ImageData { url?: string }
        interface ImgResponse { data?: ImageData[] }
        const data = (await res.json()) as ImgResponse;
        logos = (data.data ?? [])
          .map((d) => d.url ?? "")
          .filter(Boolean);
      }
    } catch {
      // Network/parse failure — fall through to placeholder
    }
  }

  // 4. Fallback to placeholder SVGs if we got fewer than 3
  while (logos.length < 3) {
    logos.push(placeholderSvg(businessName));
  }

  // 5. Upsert BrandKit — store first logo as selected, keep the prompt
  const brandKit = await prisma.brandKit.upsert({
    where: { tenantId: ctx.tenantId },
    create: {
      tenantId: ctx.tenantId,
      logoUrl: logos[0],
      logoPrompt: prompt,
    },
    update: {
      logoUrl: logos[0],
      logoPrompt: prompt,
    },
  });

  return NextResponse.json({
    ok: true,
    logos,
    brandKitId: brandKit.id,
  });
}
