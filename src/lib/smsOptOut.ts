// SMS opt-out registry.
//
// In-memory store keyed by `tenantId:phone`. On start-up the in-memory map is
// empty; the DB-backed path (CrmContact tags) fills it lazily on first lookup.
// addOptOut / removeOptOut also persist the tag to the DB when available.
//
// The caller (the send route) should filter opted-out numbers BEFORE dispatch
// and always ensure the message ends with the opt-out instruction.

import { getProvider } from "@/integrations/crm";

/** Normalise a phone number to a compact canonical form for keying. */
function normalisePhone(phone: string): string {
  return phone.replace(/\s+/g, "").toLowerCase();
}

function storeKey(tenantId: string, phone: string): string {
  return `${tenantId}:${normalisePhone(phone)}`;
}

// ---------------------------------------------------------------------------
// In-memory layer (fast-path, process-local)
// ---------------------------------------------------------------------------

const optOutSet = new Set<string>();

// ---------------------------------------------------------------------------
// DB-backed helpers
// ---------------------------------------------------------------------------

const OPT_OUT_TAG = "sms_optout";

/**
 * Check CRM contacts for this phone number's opt-out tag. Populates the
 * in-memory set as a side-effect so subsequent checks are O(1).
 * Falls back to the in-memory set when the CRM is unavailable.
 */
async function loadFromDb(tenantId: string, phone: string): Promise<boolean> {
  const key = storeKey(tenantId, phone);
  if (optOutSet.has(key)) return true;

  try {
    const crm = getProvider();
    const contacts = await crm.listContacts(tenantId);
    const norm = normalisePhone(phone);
    const match = contacts.find(
      (c) => c.phone && normalisePhone(c.phone) === norm,
    );
    if (match && Array.isArray(match.tags) && match.tags.includes(OPT_OUT_TAG)) {
      optOutSet.add(key);
      return true;
    }
  } catch {
    // CRM unavailable — rely on in-memory only
  }
  return false;
}

async function persistTagAdd(tenantId: string, phone: string): Promise<void> {
  try {
    const crm = getProvider();
    const contacts = await crm.listContacts(tenantId);
    const norm = normalisePhone(phone);
    const match = contacts.find(
      (c) => c.phone && normalisePhone(c.phone) === norm,
    );
    if (match) {
      const tags = Array.from(new Set([...(match.tags ?? []), OPT_OUT_TAG]));
      await crm.upsertContact(tenantId, {
        name: match.name,
        phone: match.phone ?? undefined,
        email: match.email ?? undefined,
        stage: match.stage,
        tags,
      });
    }
  } catch {
    // best-effort
  }
}

async function persistTagRemove(tenantId: string, phone: string): Promise<void> {
  try {
    const crm = getProvider();
    const contacts = await crm.listContacts(tenantId);
    const norm = normalisePhone(phone);
    const match = contacts.find(
      (c) => c.phone && normalisePhone(c.phone) === norm,
    );
    if (match) {
      const tags = (match.tags ?? []).filter((t: string) => t !== OPT_OUT_TAG);
      await crm.upsertContact(tenantId, {
        name: match.name,
        phone: match.phone ?? undefined,
        email: match.email ?? undefined,
        stage: match.stage,
        tags,
      });
    }
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/** True when the given phone number has opted out for this tenant. */
export async function isOptedOut(tenantId: string, phone: string): Promise<boolean> {
  return loadFromDb(tenantId, phone);
}

/** Register a phone number as opted-out for this tenant (persists to CRM). */
export async function addOptOut(tenantId: string, phone: string): Promise<void> {
  optOutSet.add(storeKey(tenantId, phone));
  await persistTagAdd(tenantId, phone);
}

/** Remove an opt-out (e.g. if the contact re-subscribes). */
export async function removeOptOut(tenantId: string, phone: string): Promise<void> {
  optOutSet.delete(storeKey(tenantId, phone));
  await persistTagRemove(tenantId, phone);
}

/** Return all currently opted-out numbers for a tenant (in-memory snapshot). */
export function listOptOuts(tenantId: string): string[] {
  const prefix = `${tenantId}:`;
  return Array.from(optOutSet)
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length));
}

/** The standard opt-out instruction suffix appended when absent. */
const OPT_OUT_SUFFIX = " Reply STOP to opt out.";

/** Ensure message ends with the opt-out instruction (POPIA §11 / CAN-SPAM). */
export function ensureOptOutFooter(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("reply stop") || lower.includes("sms stop")) {
    return message;
  }
  return message + OPT_OUT_SUFFIX;
}
