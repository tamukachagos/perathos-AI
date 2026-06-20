// Vercel static-tier live backend (SERVER-ONLY). Activated when VERCEL_TOKEN is set.
//
// One Vercel project per customer site, named "{VERCEL_PROJECT_PREFIX}-{slug}".
// provision → create (or reuse) the project; teardown → delete it.
// scale is a no-op (CDN-served; replicas don't apply).
//
// SSRF: all outbound calls go to api.vercel.com — a hardcoded constant, not
// user-supplied — so no additional SSRF guard beyond the standard token auth.

import type {
  HostingTierBackend,
  TierOpResult,
  TierProvisionInput,
  TierScaleInput,
  TierTeardownInput,
} from "./types";
import { vercelProjectForSlug } from "../service";

function teamParam(): string {
  const id = process.env.VERCEL_TEAM_ID?.trim();
  return id ? `?teamId=${encodeURIComponent(id)}` : "";
}

async function vercelFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = process.env.VERCEL_TOKEN!;
  return fetch(`https://api.vercel.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

async function ensureProject(projectName: string): Promise<string> {
  const q = teamParam();
  // Check if the project already exists.
  const getRes = await vercelFetch(`/v9/projects/${encodeURIComponent(projectName)}${q}`);
  if (getRes.ok) {
    const data = (await getRes.json()) as { id: string };
    return data.id;
  }
  // Create it.
  const createRes = await vercelFetch(`/v9/projects${q}`, {
    method: "POST",
    body: JSON.stringify({ name: projectName, framework: null, publicSource: false }),
  });
  if (!createRes.ok) {
    throw new Error(`Vercel createProject (${projectName}): ${createRes.status} ${await createRes.text()}`);
  }
  const data = (await createRes.json()) as { id: string };
  return data.id;
}

export const vercelStaticBackend: HostingTierBackend = {
  tier: "static",
  label: "StaticTier / Vercel (live)",

  async provision(input: TierProvisionInput): Promise<TierOpResult> {
    const projectName = vercelProjectForSlug(input.slug);
    const projectId = await ensureProject(projectName);
    return {
      ok: true,
      detail: `Vercel project "${projectName}" ready (${projectId}).`,
      backendRef: projectId,
    };
  },

  async scale(_input: TierScaleInput): Promise<TierOpResult> {
    return { ok: true, detail: "Static hosting does not scale by replica." };
  },

  async teardown(input: TierTeardownInput): Promise<TierOpResult> {
    const projectName = vercelProjectForSlug(input.slug);
    const q = teamParam();
    const res = await vercelFetch(
      `/v9/projects/${encodeURIComponent(projectName)}${q}`,
      { method: "DELETE" },
    );
    // 404 = already deleted; treat as success.
    if (!res.ok && res.status !== 404) {
      throw new Error(`Vercel deleteProject (${projectName}): ${res.status} ${await res.text()}`);
    }
    return { ok: true, detail: `Vercel project "${projectName}" deleted.` };
  },
};
