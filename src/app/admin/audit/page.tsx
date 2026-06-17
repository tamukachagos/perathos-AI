import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCurrentTenant } from "@/lib/authz";
import { getRepositories } from "@/lib/db";
import type { AuditEntry } from "@/lib/db/types";

// Minimal admin read path for the append-only audit log (M5 observability).
// Tenant-scoped via the session: an authenticated owner sees their own tenant's
// audit trail (publish, rollback, lead capture, DSAR erasure, …). Anonymous
// visitors are prompted to sign in. No DB needed in mock mode — the in-memory
// audit repo serves the entries for the dev tenant.
export const metadata: Metadata = {
  title: "Audit log — Launch Desk",
};

// The audit log records actions, never PII; safe to render verbatim.
export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const ctx = await getCurrentTenant();

  let entries: AuditEntry[] = [];
  if (ctx) {
    const repos = await getRepositories();
    entries = await repos.audit.list(ctx.tenantId);
  }

  return (
    <main className="published-shell privacy-page">
      <header className="published-header">
        <Link className="ghost-button back-button" href="/">
          <ArrowLeft size={16} />
          Launch Desk
        </Link>
      </header>

      <article className="privacy-body">
        <h1>Audit log</h1>
        {!ctx ? (
          <p>
            <Link className="anchor-link" href="/sign-in">
              Sign in
            </Link>{" "}
            to view your account&rsquo;s audit trail.
          </p>
        ) : entries.length === 0 ? (
          <p>No audited events yet.</p>
        ) : (
          <ul className="audit-list">
            {entries.map((e) => (
              <li key={e.id}>
                <code>{e.action}</code>
                <span className="audit-target">
                  {e.targetType ? `${e.targetType}${e.targetId ? `:${e.targetId}` : ""}` : "—"}
                </span>
                <span className="audit-when">
                  {new Date(e.createdAt).toLocaleString("en-ZA")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </article>
    </main>
  );
}
