"use client";

// Marketing Control Center — dashboard section for the autonomous agent team.
// Shows agent status, activity feed, performance KPIs, and quick actions.
// Plan-gated: Free plan shows upgrade prompt instead.

import { useEffect, useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MarketingRun {
  id: string;
  agentType: string;
  status: string;
  tokensUsed: number;
  startedAt: string;
  endedAt: string | null;
  result: {
    actions?: string[];
    error?: string;
  } | null;
}

interface AgentCard {
  id: string;
  name: string;
  description: string;
  icon: string;
  schedule: string;
}

interface TriggerState {
  loading: boolean;
  error: string | null;
  lastResult: { success: boolean; actions: string[] } | null;
}

// ---------------------------------------------------------------------------
// Agent definitions
// ---------------------------------------------------------------------------

const AGENTS: AgentCard[] = [
  {
    id: "content",
    name: "Content Agent",
    description: "Generates social posts, emails, blog posts, SMS and ad copy",
    icon: "✍",
    schedule: "On demand",
  },
  {
    id: "social",
    name: "Social Agent",
    description: "Schedules 4 posts/week across Facebook & Instagram",
    icon: "📱",
    schedule: "Daily at 09:00 SAST",
  },
  {
    id: "email",
    name: "Email Agent",
    description: "Runs welcome sequences, booking reminders, newsletters",
    icon: "📧",
    schedule: "Every hour",
  },
  {
    id: "seo",
    name: "SEO Agent",
    description: "Generates sitemaps, optimizes meta tags, finds keywords",
    icon: "🔍",
    schedule: "Daily at 09:00 SAST",
  },
  {
    id: "nurture",
    name: "Nurture Agent",
    description: "WhatsApp & SMS follow-ups for new leads",
    icon: "💬",
    schedule: "Every hour",
  },
  {
    id: "reputation",
    name: "Reputation Agent",
    description: "Drafts review responses, flags negatives, sentiment reports",
    icon: "⭐",
    schedule: "Weekly on Monday",
  },
  {
    id: "report",
    name: "Report Agent",
    description: "Weekly CMO-grade performance briefing sent to your email",
    icon: "📊",
    schedule: "Weekly on Monday",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function agentTypeLabel(agentType: string): string {
  const map: Record<string, string> = {
    content: "Content",
    "content-platform": "Content (Platform)",
    social: "Social",
    "social-platform": "Social (Platform)",
    email: "Email",
    "email-platform": "Email (Platform)",
    seo: "SEO",
    "seo-sitemap": "SEO Sitemap",
    "seo-keywords": "SEO Keywords",
    nurture: "Nurture",
    reputation: "Reputation",
    "reputation-report": "Sentiment Report",
    report: "Weekly Report",
    "report-platform": "Platform Report",
  };
  return map[agentType] ?? agentType;
}

function agentIcon(agentType: string): string {
  const map: Record<string, string> = {
    content: "✍",
    social: "📱",
    email: "📧",
    seo: "🔍",
    nurture: "💬",
    reputation: "⭐",
    report: "📊",
  };
  const base = agentType.split("-")[0];
  return map[base] ?? "🤖";
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  planTier?: "free" | "growth" | "pro";
}

export function MarketingControlCenter({ planTier = "free" }: Props) {
  const [runs, setRuns] = useState<MarketingRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [triggerStates, setTriggerStates] = useState<
    Record<string, TriggerState>
  >({});

  // ------------------------------------------------------------------
  // Fetch recent runs
  // ------------------------------------------------------------------
  const fetchRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const res = await fetch("/api/marketing/runs?limit=20");
      if (!res.ok) throw new Error("Failed to fetch runs");
      const data = (await res.json()) as { ok: boolean; runs: MarketingRun[] };
      if (data.ok) setRuns(data.runs);
    } catch {
      // Silently fail — UX shows empty state
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  useEffect(() => {
    if (planTier !== "free") {
      void fetchRuns();
    }
  }, [fetchRuns, planTier]);

  // ------------------------------------------------------------------
  // Trigger an agent
  // ------------------------------------------------------------------
  async function triggerAgent(agentId: string) {
    setTriggerStates((prev) => ({
      ...prev,
      [agentId]: { loading: true, error: null, lastResult: null },
    }));

    try {
      const res = await fetch("/api/marketing/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentType: agentId }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        result?: { success: boolean; actions: string[]; error?: string };
        detail?: string;
      };

      if (data.ok && data.result) {
        setTriggerStates((prev) => ({
          ...prev,
          [agentId]: {
            loading: false,
            error: data.result!.error ?? null,
            lastResult: {
              success: data.result!.success,
              actions: data.result!.actions,
            },
          },
        }));
        // Refresh the activity feed
        void fetchRuns();
      } else {
        setTriggerStates((prev) => ({
          ...prev,
          [agentId]: {
            loading: false,
            error: data.detail ?? "Agent run failed",
            lastResult: null,
          },
        }));
      }
    } catch (err) {
      setTriggerStates((prev) => ({
        ...prev,
        [agentId]: {
          loading: false,
          error: err instanceof Error ? err.message : "Network error",
          lastResult: null,
        },
      }));
    }
  }

  // ------------------------------------------------------------------
  // Last run info for an agent
  // ------------------------------------------------------------------
  function lastRunFor(agentId: string): MarketingRun | undefined {
    return runs.find((r) => r.agentType === agentId || r.agentType.startsWith(agentId));
  }

  // ------------------------------------------------------------------
  // Upgrade prompt for Free plan
  // ------------------------------------------------------------------
  if (planTier === "free") {
    return (
      <div
        style={{
          background: "white",
          borderRadius: 12,
          padding: "40px 32px",
          textAlign: "center",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow)",
        }}
      >
        <div style={{ fontSize: 48, marginBottom: 16 }}>🤖</div>
        <h2 style={{ color: "var(--heading)", margin: "0 0 8px" }}>
          Marketing Control Center
        </h2>
        <p style={{ color: "var(--muted)", margin: "0 0 24px", maxWidth: 420, marginInline: "auto" }}>
          Unlock your autonomous AI marketing team — 7 agents running 24/7 to
          grow your business. HubSpot-grade email, Hootsuite-grade social,
          Semrush-grade SEO, and more.
        </p>
        <a
          href="/dashboard/billing"
          style={{
            display: "inline-block",
            background: "var(--green)",
            color: "white",
            padding: "12px 28px",
            borderRadius: 8,
            fontWeight: 600,
            textDecoration: "none",
            fontSize: 15,
          }}
        >
          Upgrade to Growth — from R299/mo
        </a>
        <p style={{ color: "var(--muted)", marginTop: 16, fontSize: 13 }}>
          No credit card required to start a trial
        </p>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Full Marketing Control Center
  // ------------------------------------------------------------------

  // Derive KPIs from runs
  const thisWeekRuns = runs.filter(
    (r) =>
      new Date(r.startedAt).getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000,
  );
  const emailRuns = thisWeekRuns.filter((r) => r.agentType === "email");
  const socialRuns = thisWeekRuns.filter((r) => r.agentType === "social");
  const totalActions = thisWeekRuns.reduce(
    (s, r) => s + (r.result?.actions?.length ?? 0),
    0,
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header */}
      <div
        style={{
          background: "linear-gradient(135deg, #061a2d, #123a6f)",
          borderRadius: 12,
          padding: "24px 28px",
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div>
          <h2 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 700 }}>
            Marketing Control Center
          </h2>
          <p style={{ margin: 0, opacity: 0.75, fontSize: 13 }}>
            Powered by AI agents — running autonomously 24/7
          </p>
        </div>
        <span
          style={{
            background: "rgba(255,255,255,0.15)",
            borderRadius: 20,
            padding: "6px 14px",
            fontSize: 12,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {planTier} plan
        </span>
      </div>

      {/* KPI row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12,
        }}
      >
        {[
          { label: "Agent runs this week", value: thisWeekRuns.length },
          { label: "Total actions taken", value: totalActions },
          { label: "Email runs", value: emailRuns.length },
          { label: "Social runs", value: socialRuns.length },
        ].map((kpi) => (
          <div
            key={kpi.label}
            style={{
              background: "white",
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "16px 18px",
              boxShadow: "var(--shadow)",
            }}
          >
            <div
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: "var(--green)",
                lineHeight: 1,
              }}
            >
              {kpi.value}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
              {kpi.label}
            </div>
          </div>
        ))}
      </div>

      {/* Agent cards grid */}
      <div>
        <h3
          style={{
            margin: "0 0 14px",
            fontSize: 15,
            color: "var(--heading)",
            fontWeight: 600,
          }}
        >
          Your AI Agent Team
        </h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 12,
          }}
        >
          {AGENTS.map((agent) => {
            const lastRun = lastRunFor(agent.id);
            const ts = triggerStates[agent.id];
            const isLoading = ts?.loading ?? false;
            const lastResult = ts?.lastResult;
            const triggerError = ts?.error;

            return (
              <div
                key={agent.id}
                style={{
                  background: "white",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "16px 18px",
                  boxShadow: "var(--shadow)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {/* Agent header */}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 22 }}>{agent.icon}</span>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: 14,
                        color: "var(--heading)",
                      }}
                    >
                      {agent.name}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                      {agent.schedule}
                    </div>
                  </div>
                  {/* Status dot */}
                  {lastRun && (
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background:
                          lastRun.status === "done" ? "var(--green)" : "#ef4444",
                        flexShrink: 0,
                      }}
                      title={lastRun.status}
                    />
                  )}
                </div>

                {/* Description */}
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    color: "var(--muted)",
                    lineHeight: 1.4,
                  }}
                >
                  {agent.description}
                </p>

                {/* Last run info */}
                {lastRun && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--muted)",
                      background: "var(--app-bg)",
                      borderRadius: 6,
                      padding: "6px 8px",
                    }}
                  >
                    Last run: {timeAgo(lastRun.startedAt)} &bull;{" "}
                    {lastRun.result?.actions?.length ?? 0} actions &bull;{" "}
                    {lastRun.tokensUsed.toLocaleString()} tokens
                  </div>
                )}

                {/* Last result (from this session) */}
                {lastResult && (
                  <div
                    style={{
                      fontSize: 11,
                      padding: "6px 8px",
                      borderRadius: 6,
                      background: lastResult.success ? "#f0fdf4" : "#fef2f2",
                      color: lastResult.success ? "var(--green)" : "#dc2626",
                      border: `1px solid ${lastResult.success ? "#bbf7d0" : "#fecaca"}`,
                    }}
                  >
                    {lastResult.success ? "Completed" : "Failed"} &bull;{" "}
                    {lastResult.actions.slice(0, 2).join(" | ")}
                    {lastResult.actions.length > 2 &&
                      ` +${lastResult.actions.length - 2} more`}
                  </div>
                )}

                {/* Error */}
                {triggerError && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "#dc2626",
                      background: "#fef2f2",
                      borderRadius: 6,
                      padding: "6px 8px",
                    }}
                  >
                    {triggerError}
                  </div>
                )}

                {/* Run now button */}
                <button
                  onClick={() => void triggerAgent(agent.id)}
                  disabled={isLoading}
                  style={{
                    background: isLoading ? "var(--border)" : "var(--soft-blue)",
                    color: isLoading ? "var(--muted)" : "var(--blue)",
                    border: "none",
                    borderRadius: 6,
                    padding: "8px 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: isLoading ? "not-allowed" : "pointer",
                    transition: "background 0.15s",
                  }}
                >
                  {isLoading ? "Running..." : "Run now"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick actions */}
      <div
        style={{
          background: "white",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "18px 20px",
          boxShadow: "var(--shadow)",
        }}
      >
        <h3
          style={{
            margin: "0 0 14px",
            fontSize: 14,
            color: "var(--heading)",
            fontWeight: 600,
          }}
        >
          Quick Actions
        </h3>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {[
            {
              label: "Generate this week's social content",
              agentId: "social",
              icon: "📱",
            },
            {
              label: "Send newsletter now",
              agentId: "email",
              icon: "📧",
            },
            {
              label: "Get performance report",
              agentId: "report",
              icon: "📊",
            },
          ].map((action) => {
            const ts = triggerStates[action.agentId];
            const isLoading = ts?.loading ?? false;
            return (
              <button
                key={action.label}
                onClick={() => void triggerAgent(action.agentId)}
                disabled={isLoading}
                style={{
                  background: isLoading ? "var(--border)" : "var(--green)",
                  color: isLoading ? "var(--muted)" : "white",
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: isLoading ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span>{action.icon}</span>
                {isLoading ? "Running..." : action.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Activity feed */}
      <div
        style={{
          background: "white",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: "18px 20px",
          boxShadow: "var(--shadow)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <h3
            style={{ margin: 0, fontSize: 14, color: "var(--heading)", fontWeight: 600 }}
          >
            Agent Activity Feed
          </h3>
          <button
            onClick={() => void fetchRuns()}
            disabled={loadingRuns}
            style={{
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "4px 10px",
              fontSize: 11,
              color: "var(--muted)",
              cursor: loadingRuns ? "not-allowed" : "pointer",
            }}
          >
            {loadingRuns ? "Loading..." : "Refresh"}
          </button>
        </div>

        {runs.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "32px 0",
              color: "var(--muted)",
              fontSize: 13,
            }}
          >
            {loadingRuns
              ? "Loading activity..."
              : "No agent runs yet. Use the buttons above to trigger your first run."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {runs.map((run) => (
              <div
                key={run.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "10px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                {/* Agent icon */}
                <span
                  style={{
                    fontSize: 18,
                    flexShrink: 0,
                    width: 28,
                    textAlign: "center",
                  }}
                >
                  {agentIcon(run.agentType)}
                </span>

                {/* Details */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: 13,
                        color: "var(--heading)",
                      }}
                    >
                      {agentTypeLabel(run.agentType)}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        background:
                          run.status === "done" ? "#f0fdf4" : "#fef2f2",
                        color:
                          run.status === "done" ? "var(--green)" : "#dc2626",
                        borderRadius: 4,
                        padding: "1px 6px",
                        fontWeight: 600,
                      }}
                    >
                      {run.status}
                    </span>
                  </div>

                  {/* Top actions */}
                  {run.result?.actions && run.result.actions.length > 0 && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--muted)",
                        marginTop: 2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {run.result.actions[0]}
                      {run.result.actions.length > 1 &&
                        ` +${run.result.actions.length - 1} more`}
                    </div>
                  )}
                </div>

                {/* Right side */}
                <div
                  style={{
                    textAlign: "right",
                    flexShrink: 0,
                    fontSize: 11,
                    color: "var(--muted)",
                  }}
                >
                  <div>{timeAgo(run.startedAt)}</div>
                  {run.tokensUsed > 0 && (
                    <div>{run.tokensUsed.toLocaleString()} tokens</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
