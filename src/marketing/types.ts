"use server";

// Shared types for the Launch Desk autonomous marketing agent team.
// All monetary values in BigInt ZAR micro-cents.

// ---------------------------------------------------------------------------
// Core context passed to every agent run
// ---------------------------------------------------------------------------

export interface MarketingContext {
  tenantId: string;
  businessName: string;
  industry: string;
  location: string;
  services: string[];
  whatsapp: string;
  domain: string;
  planTier: "free" | "growth" | "pro";
  /** Owner email for report delivery */
  ownerEmail?: string;
}

// ---------------------------------------------------------------------------
// Agent result returned by every agent's run()
// ---------------------------------------------------------------------------

export interface AgentResult {
  agentType: string;
  success: boolean;
  actions: string[];
  tokensUsed: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Content pieces produced by ContentAgent
// ---------------------------------------------------------------------------

export type ContentPieceType =
  | "social-post"
  | "email"
  | "blog-post"
  | "sms"
  | "ad-copy";

export interface ContentPiece {
  type: ContentPieceType;
  content: string;
  platform?: string;
  subject?: string;
  imagePrompt?: string;
}

// ---------------------------------------------------------------------------
// Campaign (a collection of scheduled content pieces)
// ---------------------------------------------------------------------------

export interface Campaign {
  name: string;
  type: string;
  target: string;
  schedule: string;
  pieces: ContentPiece[];
}

// ---------------------------------------------------------------------------
// Marketing performance metrics
// ---------------------------------------------------------------------------

export interface MarketingMetrics {
  visits: number;
  leads: number;
  bookings: number;
  conversions: number;
  revenue: bigint;
  openRate: number;
  clickRate: number;
  followers: number;
}
