"use client";

// Launch Studio — Assistant console. The primary surface: a Claude-style chat
// thread (owner right, assistant/team left) with rich action cards, plus a
// bottom prompt input. A quiet empty state offers a few example prompts.
//
// CLIENT-SAFE: imports only React + icons, the client-safe chat model, the
// /api/agent/profile fetch (no tenant, no side effects), and the agent-team
// server ACTION by reference. It never imports a server module, the registry,
// metering, or crypto — so the client/server split stays clean.
//
// Routing of a submitted prompt (see lib/studioChat.routePrompt):
//   * no profile yet            -> onboarding (draft a profile, offer "Use it")
//   * profile + AI-team plan     -> ask the team (real action; mock = friendly)
//   * otherwise                 -> deterministic built-in guidance
// Gated actions surface as an approval card that reuses the shell's existing
// ApprovalDialog flow.

import { useEffect, useReducer, useRef, useState } from "react";
import { Send, Sparkles, UserRound } from "lucide-react";
import type { Business } from "@/lib/types";
import { SITE_TEMPLATES } from "@/lib/templates";
import {
  chatReducer,
  emptyChat,
  guidanceReply,
  hasUsableProfile,
  mockTeamReply,
  routePrompt,
  type ChatCard,
  type ChatMessage,
} from "@/lib/studioChat";
import { askTeamAction } from "@/app/agent/actions";

const STORAGE_KEY = "launchdesk:studio:chat:v1";

const EXAMPLE_PROMPTS = [
  "Make a site for my salon in Soweto",
  "Add a section about our weekend specials",
  "Help me get a web address",
  "How do customers pay me?",
];

interface Props {
  business: Business;
  authenticated: boolean;
  /** True when the tenant's plan includes the always-on AI team. */
  agentTeam: boolean;
  /** Apply a generated/drafted profile to the shell's business state. */
  onApplyProfile: (profile: Business) => void;
  /** Open the existing approval dialog for a gated checklist key. */
  onApprove: (stepKey: string) => void;
  /** Switch the shell to the Preview tab. */
  onOpenPreview: () => void;
  /** Slug of the current published site (for the "site is live" card). */
  publishedSlug: string | null;
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `m${Date.now().toString(36)}${idCounter}`;
}

export function AssistantConsole({
  business,
  authenticated,
  agentTeam,
  onApplyProfile,
  onApprove,
  onOpenPreview,
  publishedSlug,
}: Props) {
  const [state, dispatch] = useReducer(chatReducer, emptyChat);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const restored = useRef(false);

  // Restore an in-session transcript from localStorage (optional persistence).
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const messages = JSON.parse(raw) as ChatMessage[];
        for (const m of messages) {
          if (m.role === "owner") {
            dispatch({ type: "send", id: m.id, text: m.text, at: m.at });
          } else if (!m.pending) {
            dispatch({ type: "reply", id: m.id, text: m.text, card: m.card, at: m.at });
          }
        }
      }
    } catch {
      /* ignore corrupt/blocked storage */
    }
  }, []);

  // Persist the transcript (skip pending placeholders).
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const keep = state.messages.filter((m) => !m.pending);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keep));
    } catch {
      /* ignore */
    }
  }, [state.messages]);

  // Keep the thread scrolled to the newest message.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.messages]);

  async function submit(text: string) {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setBusy(true);
    setInput("");

    dispatch({ type: "send", id: nextId(), text: prompt, at: new Date().toISOString() });
    const pendingId = nextId();
    dispatch({ type: "thinking", id: pendingId, at: new Date().toISOString() });

    const route = routePrompt({
      hasProfile: hasUsableProfile(business),
      agentTeam,
    });

    try {
      if (route === "onboarding") {
        await runOnboarding(prompt, pendingId);
      } else if (route === "agent-team") {
        await runAgentTeam(prompt, pendingId);
      } else {
        const { text: reply, card } = guidanceReply(prompt);
        reply_(pendingId, reply, card);
      }
    } catch {
      reply_(
        pendingId,
        "Sorry — something went wrong on my side. Please try again in a moment.",
      );
    } finally {
      setBusy(false);
    }
  }

  function reply_(replaceId: string, text: string, card?: ChatCard) {
    dispatch({
      type: "reply",
      replaceId,
      id: nextId(),
      text,
      card,
      at: new Date().toISOString(),
    });
  }

  async function runOnboarding(prompt: string, pendingId: string) {
    const res = await fetch("/api/agent/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: prompt }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      reply_(
        pendingId,
        "Tell me a little more about your business — a sentence or two about what you do and where — and I'll draft your site.",
      );
      return;
    }
    const profile = json.profile as Business;
    reply_(
      pendingId,
      `I drafted a starting point for ${profile.name || "your business"}. Have a look — if it fits, I'll use it and you can publish whenever you're ready.`,
      {
        kind: "draft-profile",
        profile,
        lowConfidence: (json.lowConfidence ?? []) as (keyof Business)[],
      },
    );
  }

  async function runAgentTeam(prompt: string, pendingId: string) {
    // In mock mode the action returns a friendly state; we still show a warm,
    // deterministic line so the experience is identical with or without keys.
    if (authenticated) {
      try {
        await askTeamAction(prompt);
      } catch {
        // Fall through to the friendly mock reply (e.g. no DB / not entitled).
      }
    }
    const { text, card } = mockTeamReply(prompt);
    reply_(pendingId, text, card);
  }

  function applyDraft(profile: Business) {
    onApplyProfile(profile);
    dispatch({
      type: "reply",
      id: nextId(),
      text: "Done — I've set that up. You can fine-tune anything in your Profile, or open Preview to see it.",
      card: { kind: "open-preview", label: "Open Preview" },
      at: new Date().toISOString(),
    });
  }

  function applyTemplate(business: Business, label: string) {
    onApplyProfile(business);
    dispatch({
      type: "reply",
      id: nextId(),
      text: `I've loaded the ${label} template. Update your business name, phone number, and location in Profile — then open Preview to see your site.`,
      card: { kind: "open-preview", label: "Open Preview" },
      at: new Date().toISOString(),
    });
  }

  const showLiveCard = publishedSlug !== null;

  return (
    <div className="studio-console">
      <div className="studio-thread" ref={threadRef} aria-live="polite">
        {state.messages.length === 0 ? (
          <EmptyState
            onPick={(p) => void submit(p)}
            onApplyTemplate={applyTemplate}
          />
        ) : (
          state.messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              onApplyDraft={applyDraft}
              onApprove={onApprove}
              onOpenPreview={onOpenPreview}
              showLiveCard={showLiveCard}
              publishedSlug={publishedSlug}
            />
          ))
        )}
      </div>

      <form
        className="studio-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(input);
        }}
      >
        <textarea
          className="studio-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit(input);
            }
          }}
          rows={1}
          placeholder="Ask your team to build or change anything — e.g. “make a site for my salon in Soweto”"
          aria-label="Ask your team"
          disabled={busy}
        />
        <button
          className="studio-send"
          type="submit"
          disabled={busy || input.trim().length === 0}
          aria-label="Send"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}

function EmptyState({
  onPick,
  onApplyTemplate,
}: {
  onPick: (prompt: string) => void;
  onApplyTemplate: (business: Business, label: string) => void;
}) {
  return (
    <div className="studio-empty">
      <div className="studio-empty-mark">
        <Sparkles size={22} />
      </div>
      <h2>What would you like to build today?</h2>
      <p>Pick your industry to get a site ready in seconds, or describe your business below.</p>
      <div className="studio-templates">
        {SITE_TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            className="studio-template-btn"
            onClick={() => onApplyTemplate(t.business, t.label)}
          >
            <span className="studio-template-emoji" aria-hidden="true">{t.emoji}</span>
            <span className="studio-template-label">{t.label}</span>
          </button>
        ))}
      </div>
      <div className="studio-divider"><span>or describe it yourself</span></div>
      <div className="studio-examples">
        {EXAMPLE_PROMPTS.map((p) => (
          <button key={p} type="button" onClick={() => onPick(p)}>
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  onApplyDraft,
  onApprove,
  onOpenPreview,
  showLiveCard,
  publishedSlug,
}: {
  message: ChatMessage;
  onApplyDraft: (profile: Business) => void;
  onApprove: (stepKey: string) => void;
  onOpenPreview: () => void;
  showLiveCard: boolean;
  publishedSlug: string | null;
}) {
  const isOwner = message.role === "owner";
  return (
    <div className={`studio-msg ${isOwner ? "from-owner" : "from-assistant"}`}>
      {!isOwner ? (
        <div className="studio-avatar" aria-hidden="true">
          <Sparkles size={15} />
        </div>
      ) : null}
      <div className="studio-msg-body">
        {message.pending ? (
          <div className="studio-typing" aria-label="Assistant is thinking">
            <span />
            <span />
            <span />
          </div>
        ) : (
          <>
            {message.text ? <p className="studio-bubble">{message.text}</p> : null}
            {message.card ? (
              <CardView
                card={message.card}
                onApplyDraft={onApplyDraft}
                onApprove={onApprove}
                onOpenPreview={onOpenPreview}
                showLiveCard={showLiveCard}
                publishedSlug={publishedSlug}
              />
            ) : null}
          </>
        )}
      </div>
      {isOwner ? (
        <div className="studio-avatar owner" aria-hidden="true">
          <UserRound size={15} />
        </div>
      ) : null}
    </div>
  );
}

function CardView({
  card,
  onApplyDraft,
  onApprove,
  onOpenPreview,
  showLiveCard,
  publishedSlug,
}: {
  card: ChatCard;
  onApplyDraft: (profile: Business) => void;
  onApprove: (stepKey: string) => void;
  onOpenPreview: () => void;
  showLiveCard: boolean;
  publishedSlug: string | null;
}) {
  if (card.kind === "draft-profile") {
    const p = card.profile;
    return (
      <div className="studio-card">
        <div className="studio-card-head">
          <strong>{p.name || "Your business"}</strong>
          <span>{[p.industry, p.location].filter(Boolean).join(" · ")}</span>
        </div>
        {p.offer ? <p className="studio-card-line">{p.offer}</p> : null}
        {card.lowConfidence.length > 0 ? (
          <p className="studio-card-note">
            A couple of details I wasn&apos;t sure about — you can fix them after.
          </p>
        ) : null}
        <div className="studio-card-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={onOpenPreview}
          >
            Preview
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => onApplyDraft(p)}
          >
            Use it
          </button>
        </div>
      </div>
    );
  }

  if (card.kind === "approval") {
    return (
      <div className="studio-card studio-card-approval">
        <p className="studio-card-line">
          This one needs your sign-off before I go ahead.
        </p>
        <div className="studio-card-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => onApprove(card.stepKey)}
          >
            Review &amp; approve: {card.label}
          </button>
        </div>
      </div>
    );
  }

  if (card.kind === "site-live") {
    if (!showLiveCard) return null;
    return (
      <div className="studio-card">
        <p className="studio-card-line">Your site is live.</p>
        <div className="studio-card-actions">
          <button type="button" className="ghost-button" onClick={onOpenPreview}>
            See it in Preview
          </button>
        </div>
      </div>
    );
  }

  // open-preview
  return (
    <div className="studio-card-inline">
      <button type="button" className="ghost-button" onClick={onOpenPreview}>
        {card.label}
      </button>
      {publishedSlug ? (
        <a className="anchor-link" href={`/s/${publishedSlug}`} target="_blank" rel="noreferrer">
          Open live site
        </a>
      ) : null}
    </div>
  );
}
