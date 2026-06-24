import "server-only";

// Brand adapter — logo generation via OpenRouter (FLUX Schnell) + brand kit
// persistence in the BrandKit Prisma model.
// Gated on OPENROUTER_API_KEY (already set in prod).

import { prisma } from "@/lib/prisma";

const OPENROUTER_IMAGE_URL = "https://openrouter.ai/api/v1/images/generations";
const LOGO_MODEL = "black-forest-labs/flux-schnell";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogoStyle = "minimalist" | "bold" | "modern" | "vintage" | "playful" | "professional";

export interface BrandKitData {
  logoUrl?: string;
  logoPrompt?: string;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  fontFamily?: string;
  tagline?: string;
}

export interface BrandKitRecord {
  id: string;
  tenantId: string;
  logoUrl?: string | null;
  logoPrompt?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
  fontFamily?: string | null;
  tagline?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LogoResult {
  imageUrl: string;
  prompt: string;
}

export interface BrandProvider {
  generateLogo(
    tenantId: string,
    businessName: string,
    industry: string,
    style: LogoStyle,
  ): Promise<LogoResult>;
  saveBrandKit(tenantId: string, data: BrandKitData): Promise<BrandKitRecord>;
  getBrandKit(tenantId: string): Promise<BrandKitRecord | null>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildLogoPrompt(businessName: string, industry: string, style: LogoStyle): string {
  return (
    `${style} logo for "${businessName}", a ${industry} business. ` +
    `Clean vector-style, white background, professional branding, no text overlays.`
  );
}

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

export function createMockAdapter(): BrandProvider {
  const kitStore = new Map<string, BrandKitRecord>();

  return {
    async generateLogo(tenantId, businessName, industry, style) {
      const prompt = buildLogoPrompt(businessName, industry, style);
      const imageUrl = `https://placehold.co/512x512/EEE/999?text=${encodeURIComponent(businessName)}`;
      console.log("[mock:brand] generateLogo", { tenantId, prompt });
      return { imageUrl, prompt };
    },

    async saveBrandKit(tenantId, data) {
      const existing = kitStore.get(tenantId);
      const record: BrandKitRecord = {
        id: existing?.id ?? `mock-kit-${Date.now()}`,
        tenantId,
        ...data,
        logoUrl: data.logoUrl ?? existing?.logoUrl ?? null,
        logoPrompt: data.logoPrompt ?? existing?.logoPrompt ?? null,
        primaryColor: data.primaryColor ?? existing?.primaryColor ?? null,
        secondaryColor: data.secondaryColor ?? existing?.secondaryColor ?? null,
        accentColor: data.accentColor ?? existing?.accentColor ?? null,
        fontFamily: data.fontFamily ?? existing?.fontFamily ?? null,
        tagline: data.tagline ?? existing?.tagline ?? null,
        createdAt: existing?.createdAt ?? new Date(),
        updatedAt: new Date(),
      };
      kitStore.set(tenantId, record);
      console.log("[mock:brand] saveBrandKit", tenantId);
      return record;
    },

    async getBrandKit(tenantId) {
      return kitStore.get(tenantId) ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// Real adapter — OpenRouter image generation + Prisma BrandKit
// ---------------------------------------------------------------------------

interface OpenRouterImageResponse {
  data?: Array<{ url?: string; b64_json?: string }>;
}

export function createRealAdapter(): BrandProvider {
  const apiKey = process.env.OPENROUTER_API_KEY!;

  return {
    async generateLogo(tenantId, businessName, industry, style) {
      const prompt = buildLogoPrompt(businessName, industry, style);

      const res = await fetch(OPENROUTER_IMAGE_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: LOGO_MODEL,
          prompt,
          n: 1,
          size: "512x512",
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`OpenRouter image generation error ${res.status}: ${text}`);
      }

      const json = (await res.json()) as OpenRouterImageResponse;
      const imageUrl = json.data?.[0]?.url ?? "";
      if (!imageUrl) throw new Error("OpenRouter returned no image URL");

      return { imageUrl, prompt };
    },

    async saveBrandKit(tenantId, data) {
      return prisma.brandKit.upsert({
        where: { tenantId },
        create: { tenantId, ...data },
        update: { ...data },
      }) as unknown as BrandKitRecord;
    },

    async getBrandKit(tenantId) {
      return prisma.brandKit.findUnique({ where: { tenantId } }) as unknown as BrandKitRecord | null;
    },
  };
}

// ---------------------------------------------------------------------------
// Readiness + public surface
// ---------------------------------------------------------------------------

export function isConfigured(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

export function getProvider(): BrandProvider {
  if (isConfigured()) {
    return createRealAdapter();
  }
  return createMockAdapter();
}
