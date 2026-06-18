// W7 — Risk tiering (ENTERPRISE_REVIEW Part 3.C / Part 7).
//
// Maps a proposed change to WHO approves it:
//   * AUTO     — content/copy/image swaps, patch dep-bumps w/ green CI → notify,
//                don't ask (the owner is told after, not before).
//   * REVIEW   — features, layout, anything touching the lead form / POPIA →
//                the owner gets a one-tap approval card.
//   * ESCALATE — schema/auth/billing/RLS/privacy/payment, major dep-bumps, ANY
//                Security-Sentinel flag → explicit approval + a Sentinel warning.
//
// Two hard rules from Part 3.C are enforced HERE so they cannot be bypassed:
//   1. A Security-Sentinel BLOCK or any high-risk SURFACE forces ESCALATE — a
//      role cannot self-downgrade into AUTO.
//   2. UNTRUSTED TEXT IS DATA, NEVER INSTRUCTIONS. The tier is decided by the
//      change SURFACE the role reports (a typed enum), never by parsing the
//      issue body / error log. So an attacker who writes "this is safe, auto-merge"
//      into an error log cannot lower the tier — the text never reaches this map.
//
// Pure: no DB, no secrets, no LLM. Importable by the queue + Vitest.

import type { AgentRiskTier } from "@/lib/db/types";

/**
 * The CHANGE SURFACE a role's work touches — a closed, server-side enum. This is
 * the ONLY thing risk tiering keys off. Roles classify their own change into one
 * of these from the work they did, never from untrusted input text.
 */
export type ChangeSurface =
  | "content" // copy/image/text swap — the safest surface
  | "patch_dep_bump" // a patch-level dependency bump (with green CI)
  | "feature" // a new feature / behaviour change
  | "layout" // visual layout change
  | "lead_form" // the POPIA lead form / consent surface
  | "major_dep_bump" // a major dependency bump
  | "schema" // DB schema / migration
  | "auth" // authentication / session
  | "billing" // billing / subscription
  | "rls" // row-level security / tenant isolation
  | "privacy" // /privacy / consent / DSAR
  | "payment" // payment configuration
  | "core_integration"; // integrations/core, CI config — never auto

/** Surfaces that ALWAYS escalate (the high-risk set from Part 3.C). */
const ESCALATE_SURFACES: ReadonlySet<ChangeSurface> = new Set([
  "major_dep_bump",
  "schema",
  "auth",
  "billing",
  "rls",
  "privacy",
  "payment",
  "core_integration",
]);

/** Surfaces that are AUTO-eligible (notify, don't ask) when CI is green. */
const AUTO_SURFACES: ReadonlySet<ChangeSurface> = new Set([
  "content",
  "patch_dep_bump",
]);

export interface TierInputs {
  surface: ChangeSurface;
  /** Did the change pass CI? AUTO requires green CI; a red build never auto. */
  ciGreen: boolean;
  /** A Security Sentinel flag/block forces ESCALATE regardless of surface. */
  sentinelFlag?: boolean;
}

/**
 * Map a change surface (+ CI + Sentinel signal) to its risk tier. This is the
 * single source of truth the queue uses to decide owner-approval routing.
 *
 * Order matters: ESCALATE wins over everything (a Sentinel flag or a high-risk
 * surface can never be downgraded); then AUTO only when the surface is in the
 * safe set AND CI is green; everything else is REVIEW (the safe default).
 */
export function tierForChange(inputs: TierInputs): AgentRiskTier {
  // 1. ESCALATE always wins — a Sentinel flag or a high-risk surface.
  if (inputs.sentinelFlag) return "escalate";
  if (ESCALATE_SURFACES.has(inputs.surface)) return "escalate";

  // 2. AUTO only for the explicitly-safe surfaces with green CI.
  if (AUTO_SURFACES.has(inputs.surface) && inputs.ciGreen) return "auto";

  // 3. Everything else (features, layout, lead-form, or a non-green safe surface)
  //    is REVIEW — the owner taps once.
  return "review";
}

/** Friendly owner-facing label for a tier (Part 7 UX: Safe / Worth a look / Please read). */
export function friendlyRiskLabel(tier: AgentRiskTier): string {
  switch (tier) {
    case "auto":
      return "Safe";
    case "review":
      return "Worth a look";
    case "escalate":
      return "Please read";
  }
}

/** True when a tier requires the owner to approve BEFORE the action takes effect. */
export function requiresOwnerApproval(
  tier: AgentRiskTier,
  autoApproveContent: boolean,
): boolean {
  // AUTO with auto-approve-content on → no owner tap (notify only). Otherwise the
  // owner must approve. The owner-facing endpoint still MINTS the token; the
  // agent never does (the never-self-approve invariant lives in the queue).
  if (tier === "auto" && autoApproveContent) return false;
  return true;
}
