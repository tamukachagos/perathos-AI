"use server";

// W7 — Owner-facing agent-team server actions (ENTERPRISE_REVIEW Part 7).
//
// The owner UX: an "Ask your team" box (plain English → a Builder job), an
// activity feed (rendered from audit_log + AgentJob), approval cards (preview +
// a friendly risk label), and the pause/kill switch. All tenant scoping comes
// from requireTenant(); the client never supplies a tenant. The whole surface is
// gated behind the `agentTeam` entitlement — an unentitled tenant gets an upgrade
// prompt, never the controls.
//
// IMPORTANT (the never-self-approve invariant): these actions enqueue/process
// jobs and read approval REQUESTS, but they do NOT mint approval tokens. Token
// minting stays exclusively in src/app/approvals/* (the owner-facing endpoint),
// reached when the owner taps "approve" on a card. The agent has no signing path.

import { revalidatePath } from "next/cache";
import type { Business } from "@/lib/types";
import { requireTenant } from "@/lib/authz";
import { getRepositories } from "@/lib/db";
import { getEntitlements } from "@/lib/billing/service";
import { formatMicroZar } from "@/lib/billing/meteringConfig";
import {
  enqueueRun,
  processQueue,
  friendlyRiskLabel,
  type AgentRiskTier,
} from "@/integrations/agentTeam";

export interface ActivityItem {
  id: string;
  /** Plain-language line, e.g. "Your team fixed a failed deploy — live again." */
  message: string;
  /** ISO timestamp. */
  at: string;
  role: string | null;
}

export interface ApprovalCard {
  jobId: string;
  verb: string;
  /** A preview link the owner can open (the PR / deploy preview). */
  previewUrl: string | null;
  /** Friendly risk label: Safe / Worth a look / Please read. */
  riskLabel: string;
  riskTier: AgentRiskTier;
  summary: string;
  at: string;
}

export interface AgentState {
  /** Whether the tenant is entitled to the agent team (gates the whole panel). */
  entitled: boolean;
  /** The kill switch — when true, all jobs are halted. */
  paused: boolean;
  autoApproveContent: boolean;
  monthlyCapZar: string;
  activity: ActivityItem[];
  approvals: ApprovalCard[];
  /** Counts for the header chip. */
  jobsTotal: number;
  jobsAwaiting: number;
}

/** Friendly, owner-facing activity lines keyed off the agent audit actions. */
function activityMessage(
  action: string,
  metadata: Record<string, unknown> | null,
): string | null {
  const summary =
    metadata && typeof metadata.summary === "string" ? metadata.summary : null;
  switch (action) {
    case "agent.completed":
      return summary ?? "Your team completed a task.";
    case "agent.auto_applied":
      return "Your team applied a safe update automatically.";
    case "agent.approval_requested":
      return summary ?? "Your team has something for you to approve.";
    case "agent.blocked":
      return "Your team paused a task until you top up or resume.";
    case "agent.enqueued":
      return "Your team started working on something.";
    case "agent.paused":
      return "Your team is paused.";
    default:
      return null;
  }
}

/** Read the full agent state for the owner panel. Tenant from the session. */
export async function getAgentStateAction(): Promise<AgentState> {
  const ctx = await requireTenant();
  const repos = await getRepositories();
  const entitlements = await getEntitlements(repos, ctx.tenantId);

  if (!entitlements.agentTeam) {
    // Unentitled: return a minimal state so the UI shows the upgrade prompt.
    return {
      entitled: false,
      paused: false,
      autoApproveContent: true,
      monthlyCapZar: formatMicroZar(0n),
      activity: [],
      approvals: [],
      jobsTotal: 0,
      jobsAwaiting: 0,
    };
  }

  const policy = await repos.agentPolicies.get(ctx.tenantId);
  const jobs = await repos.agentJobs.listRecent(ctx.tenantId, 50);
  const auditRows = await repos.audit.list(ctx.tenantId);

  // Activity feed = agent audit rows → plain-language lines (newest first).
  const activity: ActivityItem[] = [];
  for (const row of auditRows) {
    if (!row.action.startsWith("agent.")) continue;
    const message = activityMessage(row.action, row.metadata);
    if (!message) continue;
    const role =
      row.metadata && typeof row.metadata.role === "string"
        ? row.metadata.role
        : null;
    activity.push({ id: row.id, message, at: row.createdAt, role });
    if (activity.length >= 20) break;
  }

  // Approval cards = the awaiting_approval jobs joined to their request audit row.
  const requestRows = auditRows.filter(
    (r) => r.action === "agent.approval_requested",
  );
  const approvals: ApprovalCard[] = [];
  for (const job of jobs) {
    if (job.status !== "awaiting_approval") continue;
    const req = requestRows.find((r) => r.targetId === job.id);
    const meta = req?.metadata ?? {};
    const verb =
      typeof meta.verb === "string" ? meta.verb : "github.mergePR";
    const summary =
      typeof meta.summary === "string"
        ? meta.summary
        : "Your team prepared a change for your approval.";
    approvals.push({
      jobId: job.id,
      verb,
      previewUrl: job.prUrl,
      riskLabel: friendlyRiskLabel(job.riskTier),
      riskTier: job.riskTier,
      summary,
      at: job.updatedAt,
    });
  }

  return {
    entitled: true,
    paused: policy.pausedByOwner,
    autoApproveContent: policy.autoApproveContent,
    monthlyCapZar: formatMicroZar(policy.monthlySpendCapMicro),
    activity,
    approvals,
    jobsTotal: jobs.length,
    jobsAwaiting: approvals.length,
  };
}

/**
 * "Ask your team" — a plain-English request becomes a Builder run. Enqueues the
 * DAG and processes the queue inline (mock mode); the result surfaces as activity
 * + (for risky output) an approval card. Returns the refreshed state.
 */
export async function askTeamAction(request: string): Promise<AgentState> {
  const ctx = await requireTenant();
  const repos = await getRepositories();
  const entitlements = await getEntitlements(repos, ctx.tenantId);
  if (!entitlements.agentTeam) {
    throw new Error("Your plan does not include the AI team.");
  }
  const text = request.trim().slice(0, 2_000);
  if (!text) throw new Error("Tell your team what you'd like in plain English.");

  const primary = await repos.businesses.getPrimary(ctx.tenantId);
  if (!primary) throw new Error("Add your business details first.");
  const { id: _id, tenantId: _t, ...business } = primary;
  void _id;
  void _t;
  const slug = await primarySlug(repos, ctx.tenantId);

  await enqueueRun(
    { repos },
    {
      tenantId: ctx.tenantId,
      trigger: "owner_request",
      business: business as Business,
      slug,
      // The owner's words are DATA — hashed by the queue, never instructions.
      triggerData: text,
    },
  );
  await processQueue({ repos }, ctx.tenantId, business as Business, slug);

  revalidatePath("/agent");
  revalidatePath("/");
  return getAgentStateAction();
}

/** Toggle the pause/kill switch. A pause halts all the tenant's jobs. */
export async function setPausedAction(paused: boolean): Promise<AgentState> {
  const ctx = await requireTenant();
  const repos = await getRepositories();
  const entitlements = await getEntitlements(repos, ctx.tenantId);
  if (!entitlements.agentTeam) {
    throw new Error("Your plan does not include the AI team.");
  }
  await repos.agentPolicies.update(ctx.tenantId, { pausedByOwner: paused });
  // When pausing, immediately halt any queued jobs (processQueue marks them
  // blocked when it sees the pause flag; we run it so the kill is immediate).
  if (paused) {
    const primary = await repos.businesses.getPrimary(ctx.tenantId);
    if (primary) {
      const { id: _id, tenantId: _t, ...business } = primary;
      void _id;
      void _t;
      const slug = await primarySlug(repos, ctx.tenantId);
      await processQueue({ repos }, ctx.tenantId, business as Business, slug);
    }
  }
  await repos.audit.append(ctx.tenantId, {
    actorId: ctx.userId,
    action: paused ? "agent.paused_by_owner" : "agent.resumed_by_owner",
    targetType: "agent_policy",
    targetId: ctx.tenantId,
    metadata: { paused },
  });
  revalidatePath("/agent");
  return getAgentStateAction();
}

/** The tenant's primary published slug (or a derived default for the repo). */
async function primarySlug(
  repos: Awaited<ReturnType<typeof getRepositories>>,
  tenantId: string,
): Promise<string> {
  const sites = await repos.sites.listByTenant(tenantId);
  if (sites[0]) return sites[0].slug;
  const primary = await repos.businesses.getPrimary(tenantId);
  const name = primary?.name ?? "my-site";
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "my-site"
  );
}
