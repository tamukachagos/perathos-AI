// AgentProvider selection — mirrors selectBillingProvider() in
// integrations/payment/subscription.ts.
//
// The AgentProvider turns a plain-language business description into a structured
// Business profile. MOCK by default (deterministic heuristic, no API key); the
// real Claude impl is returned only once ANTHROPIC_API_KEY is present. With no
// key the whole onboarding wizard runs on the mock — the dormant contract.

import type { GeneratedProfile } from "./generateProfile";
import { generateBusinessProfile } from "./generateProfile";
import {
  generateBusinessProfileWithClaude,
  type AgentMeterContext,
} from "./claudeProfile";

/** The provider name an impl reports (useful for logging/telemetry, never PII). */
export interface AgentProvider {
  readonly name: string;
  /** True when this impl makes a real AI call (false for the mock heuristic). */
  readonly real: boolean;
  /**
   * Turn free text into a structured (partial) Business profile for review.
   * W3: an OPTIONAL metering context routes the real call through the LLM
   * router's tenant wallet (pre-flight credit gate + per-tier metered debit).
   * Absent (the anonymous pre-sign-in wizard route) → routed but NOT metered.
   */
  generateProfile(
    description: string,
    ctx?: AgentMeterContext,
  ): Promise<GeneratedProfile>;
}

/** Mock AgentProvider: the deterministic heuristic, no secrets, runs anywhere. */
export function mockAgentProvider(): AgentProvider {
  return {
    name: "mock",
    real: false,
    // The mock ignores the metering context (no real model call to meter).
    generateProfile: (description: string) =>
      generateBusinessProfile(description),
  };
}

/** Real AgentProvider: routes through the LLM router, with mock fallback on error. */
export function claudeAgentProvider(): AgentProvider {
  return {
    name: "claude",
    real: true,
    generateProfile: generateBusinessProfileWithClaude,
  };
}

/**
 * Select the active AgentProvider. MOCK by default; returns the real Claude
 * provider only when ANTHROPIC_API_KEY OR OPENROUTER_API_KEY is set (the LLM
 * router selects the concrete backend). Mirrors selectBillingProvider().
 */
export function selectAgentProvider(): AgentProvider {
  const hasLlmKey =
    Boolean(process.env.ANTHROPIC_API_KEY?.trim()) ||
    Boolean(process.env.OPENROUTER_API_KEY?.trim());
  return hasLlmKey ? claudeAgentProvider() : mockAgentProvider();
}
