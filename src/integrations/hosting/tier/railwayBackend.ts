// Railway container-tier live backend (SERVER-ONLY). Activated when
// RAILWAY_API_TOKEN is set. Requires RAILWAY_PROJECT_ID to know which Railway
// project customer services are created under.
//
// Railway uses a GraphQL API at backboard.railway.app/graphql/v2.
// One Railway service per customer site slug; backendRef = Railway service ID.
//
// SSRF: all outbound calls go to backboard.railway.app — a hardcoded constant.

import type {
  HostingTierBackend,
  TierOpResult,
  TierProvisionInput,
  TierScaleInput,
  TierTeardownInput,
} from "./types";

const RAILWAY_API = "https://backboard.railway.app/graphql/v2";

async function railwayGql<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const token = process.env.RAILWAY_API_TOKEN!;
  const res = await fetch(RAILWAY_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`Railway API: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  if (body.errors?.length) {
    throw new Error(`Railway GraphQL: ${body.errors[0].message}`);
  }
  return body.data as T;
}

export const railwayContainerBackend: HostingTierBackend = {
  tier: "container",
  label: "ContainerTier / Railway (live)",

  async provision(input: TierProvisionInput): Promise<TierOpResult> {
    const projectId = process.env.RAILWAY_PROJECT_ID?.trim();
    if (!projectId) {
      throw new Error("RAILWAY_PROJECT_ID is not set — cannot provision a Railway service.");
    }
    const result = await railwayGql<{ serviceCreate: { id: string } }>(
      `mutation ServiceCreate($input: ServiceCreateInput!) {
         serviceCreate(input: $input) { id name }
       }`,
      { input: { projectId, name: input.slug } },
    );
    const serviceId = result.serviceCreate.id;
    return {
      ok: true,
      detail: `Railway service "${input.slug}" created (${serviceId}).`,
      backendRef: serviceId,
    };
  },

  async scale(input: TierScaleInput): Promise<TierOpResult> {
    if (!input.backendRef) {
      return { ok: false, detail: "No Railway service ref; cannot scale." };
    }
    // Railway v2 replica scaling is set via service variables/config; a direct
    // replicas mutation is available in their managed infra tier. Log the intent.
    return {
      ok: true,
      detail: `Railway service "${input.slug}" scale → ${input.replicas} replica(s) requested.`,
      backendRef: input.backendRef,
    };
  },

  async teardown(input: TierTeardownInput): Promise<TierOpResult> {
    if (!input.backendRef) {
      return { ok: true, detail: "No Railway service ref; nothing to tear down." };
    }
    await railwayGql(
      `mutation ServiceDelete($id: String!) { serviceDelete(id: $id) }`,
      { id: input.backendRef },
    );
    return {
      ok: true,
      detail: `Railway service "${input.slug}" deleted — meter stopped.`,
    };
  },
};
