// Launch Studio — client-safe chat model + reducer for the Assistant console.
//
// This module is PURE (no React, no DOM, no server imports) so it can be unit
// tested in the node vitest environment and imported by the "use client"
// console without dragging any server module into the client bundle.
//
// The Assistant console keeps an in-session list of messages. A message is
// either a plain text bubble (from the owner or the assistant/team) or an
// assistant message carrying a "card" — a small interactive affordance the
// owner can act on (preview a draft, apply it, open the live site, approve a
// gated action). Cards are described declaratively here; the React layer renders
// them and wires the buttons to the existing server actions.

import type { Business } from "./types";

/** Who authored a message. */
export type ChatRole = "owner" | "assistant";

/**
 * A card attached to an assistant message. The console renders each kind with
 * the right buttons; the data needed to act lives on the card so the reducer
 * stays pure and the React layer just dispatches the existing actions.
 */
export type ChatCard =
  | {
      kind: "draft-profile";
      /** The generated profile the owner can review + apply. */
      profile: Business;
      /** Fields the generator was unsure about (shown as "please check"). */
      lowConfidence: (keyof Business)[];
    }
  | {
      kind: "site-live";
      /** Slug of the site that just went live, for the Preview link. */
      slug: string;
    }
  | {
      kind: "approval";
      /** The gated checklist key (domain / payments / email) to approve. */
      stepKey: string;
      label: string;
    }
  | {
      kind: "open-preview";
      /** A nudge to flip to the Preview tab to see a change. */
      label: string;
    };

export interface ChatMessage {
  id: string;
  role: ChatRole;
  /** Plain-language body. May be empty when the message is purely a card. */
  text: string;
  /** Optional action affordance. */
  card?: ChatCard;
  /** ISO timestamp. */
  at: string;
  /** True while the assistant is "thinking" (renders a typing indicator). */
  pending?: boolean;
}

export interface ChatState {
  messages: ChatMessage[];
}

export type ChatAction =
  | { type: "send"; id: string; text: string; at: string }
  | { type: "thinking"; id: string; at: string }
  | {
      type: "reply";
      /** When set, replaces the pending placeholder with this id. */
      replaceId?: string;
      id: string;
      text: string;
      card?: ChatCard;
      at: string;
    }
  | { type: "reset" };

export const emptyChat: ChatState = { messages: [] };

/**
 * The chat reducer. Pure and total: every action returns a new state and never
 * mutates the input. `thinking` appends a pending assistant bubble; `reply`
 * either replaces that placeholder (by `replaceId`) or appends a fresh bubble.
 */
export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "send":
      return {
        messages: [
          ...state.messages,
          { id: action.id, role: "owner", text: action.text, at: action.at },
        ],
      };
    case "thinking":
      return {
        messages: [
          ...state.messages,
          { id: action.id, role: "assistant", text: "", at: action.at, pending: true },
        ],
      };
    case "reply": {
      const next: ChatMessage = {
        id: action.id,
        role: "assistant",
        text: action.text,
        card: action.card,
        at: action.at,
      };
      if (action.replaceId) {
        const idx = state.messages.findIndex((m) => m.id === action.replaceId);
        if (idx >= 0) {
          const messages = state.messages.slice();
          messages[idx] = next;
          return { messages };
        }
      }
      return { messages: [...state.messages, next] };
    }
    case "reset":
      return emptyChat;
    default:
      return state;
  }
}

/** How the console should handle a submitted prompt. */
export type PromptRoute = "onboarding" | "agent-team" | "guidance";

/**
 * Decide what a submitted prompt should do. The rule is intentionally simple
 * and non-technical:
 *   - No usable business profile yet  -> run onboarding (draft a profile).
 *   - Profile exists + the owner is entitled to the AI team -> ask the team.
 *   - Otherwise -> answer with friendly built-in guidance (no AI-team gate).
 */
export function routePrompt(opts: {
  hasProfile: boolean;
  agentTeam: boolean;
}): PromptRoute {
  if (!opts.hasProfile) return "onboarding";
  if (opts.agentTeam) return "agent-team";
  return "guidance";
}

/**
 * Whether the current business looks like a real, owner-entered profile (so we
 * know to skip onboarding). The seed default has a name, so we treat a profile
 * as "present" once it has a non-empty name AND at least one of the descriptive
 * fields the owner would fill in.
 */
export function hasUsableProfile(business: Pick<Business, "name" | "offer" | "services">): boolean {
  const name = business.name?.trim() ?? "";
  const offer = business.offer?.trim() ?? "";
  const services = business.services?.trim() ?? "";
  return name.length > 0 && (offer.length > 0 || services.length > 0);
}

/**
 * A deterministic, friendly built-in reply for the "guidance" route (mock mode,
 * or owners not on the AI-team plan). Keeps copy non-technical and points the
 * owner at the right tool, without ever asking them to configure anything.
 */
export function guidanceReply(prompt: string): { text: string; card?: ChatCard } {
  const p = prompt.toLowerCase();
  if (/(domain|web address|\.co\.za|\.com)\b/.test(p)) {
    return {
      text: "Happy to help with your web address. Open the Domain section from the menu and I'll check what's available — names like .co.za and .com — with live prices. You approve before anything is bought.",
    };
  }
  if (/(whatsapp|chat|order|sell|catalog)/.test(p)) {
    return {
      text: "You can take orders and send payment links right inside WhatsApp. Open the WhatsApp section to list a few products — your free click-to-chat button stays on your site either way.",
    };
  }
  if (/(publish|go live|live|launch)/.test(p)) {
    return {
      text: "When you're ready, hit Update site on the Preview tab and your site goes live — I handle the rest. Want to take a look first?",
      card: { kind: "open-preview", label: "Open Preview" },
    };
  }
  if (/(price|cost|credit|pay|spend|budget)/.test(p)) {
    return {
      text: "You only ever pay from your prepaid credits, in Rand — never more than you've topped up. You can see your balance and history in the Credits section.",
    };
  }
  return {
    text: "I can change your wording, add a section, set up your web address, get you found on Google, or help you sell on WhatsApp. Tell me what you'd like in plain words, or pick a section from the menu — I'll guide you through it.",
  };
}

/** A deterministic, friendly mock reply for the AI-team route (no keys/DB). */
export function mockTeamReply(prompt: string): { text: string; card?: ChatCard } {
  const guided = guidanceReply(prompt);
  return {
    text: `Your team is on it — ${lowerFirst(guided.text)}`,
    card: guided.card,
  };
}

function lowerFirst(s: string): string {
  return s.length > 0 ? s[0].toLowerCase() + s.slice(1) : s;
}
