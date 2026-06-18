// W5 — Hosting control-plane sweeps (server-only). The bridge the crons call.
//
// Two platform-wide sweeps, both running with NO tenant session (they resolve
// the per-tenant rows via the repos' cross-tenant resolvers — SECURITY DEFINER
// under Postgres — then act INSIDE each tenant's scope):
//   * sweepProvisioningQueue — run every runnable provisioning_jobs job against
//     its tier backend (provision/scale/teardown) and settle its async W1 op.
//   * sweepHostingMeter — meter every RUNNING managed deployment for one tick,
//     debiting cpu_hour + storage_gb_mo and applying the cost-safe guardrails
//     (suspend on low balance / kill switch, anomaly flag).
//
// Both are invoked from the operations-reconcile cron (the queue) and a dedicated
// metering cron (the meter), so provisioning + billing advance on serverless
// where the request process is gone after the 202.

import { getRepositories } from "@/lib/db";
import { settleOperation } from "@/integrations/core/operationStore";
import { meterDeploymentTick, runProvisioningJob } from "./provision";

/**
 * Run every runnable provisioning job to completion (or one step of its bounded
 * retry). Returns the count of jobs processed. The op-settle is wired to the W1
 * operation store here so provision.ts stays decoupled/testable.
 */
export async function sweepProvisioningQueue(
  now = Date.now(),
): Promise<number> {
  const repos = await getRepositories();
  const jobs = await repos.provisioningJobs.listRunnableAllTenants(now);
  let processed = 0;
  for (const job of jobs) {
    await runProvisioningJob(repos, job, async (operationId, status, detail, tenantId) => {
      await settleOperation(operationId, status, detail, null, tenantId);
    });
    processed += 1;
  }
  return processed;
}

/**
 * Meter every running managed deployment for one tick. `tickKey` defaults to the
 * current hour so the per-tick debit is idempotent (a cron overlap on serverless
 * re-uses the same key and never double-debits). Returns counts.
 */
export async function sweepHostingMeter(
  tickKey = currentTickKey(),
): Promise<{ metered: number; suspended: number }> {
  const repos = await getRepositories();
  const running = await repos.hostingDeployments.listRunningAllTenants();
  let metered = 0;
  let suspended = 0;
  for (const deployment of running) {
    const result = await meterDeploymentTick(repos, deployment, tickKey);
    if (result.metered) metered += 1;
    if (result.suspended) suspended += 1;
  }
  return { metered, suspended };
}

/** The hour-granular tick key, "YYYY-MM-DDTHH" (UTC), for idempotent metering. */
export function currentTickKey(at: Date = new Date()): string {
  return at.toISOString().slice(0, 13); // e.g. 2026-06-18T14
}
