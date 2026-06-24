"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Stage = "new" | "contacted" | "qualified" | "won" | "lost";
type Source = "all" | "lead-form" | "booking" | "whatsapp" | "manual";

interface CrmContact {
  id: string;
  tenantId: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  source: string;
  stage: string;
  notes?: string | null;
  tags: string[];
  lastContactAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AddContactForm {
  name: string;
  phone: string;
  email: string;
  source: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STAGES: { key: Stage; label: string; color: string }[] = [
  { key: "new", label: "New", color: "#1065e5" },
  { key: "contacted", label: "Contacted", color: "#ffc457" },
  { key: "qualified", label: "Qualified", color: "#0f7a4f" },
  { key: "won", label: "Won", color: "#0f5132" },
  { key: "lost", label: "Lost", color: "#667085" },
];

const SOURCES: { key: Source; label: string }[] = [
  { key: "all", label: "All sources" },
  { key: "lead-form", label: "Lead form" },
  { key: "booking", label: "Booking" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "manual", label: "Manual" },
];

const EMPTY_FORM: AddContactForm = {
  name: "",
  phone: "",
  email: "",
  source: "manual",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SourceBadge({ source }: { source: string }) {
  const labels: Record<string, string> = {
    "lead-form": "Lead form",
    booking: "Booking",
    whatsapp: "WhatsApp",
    manual: "Manual",
  };
  return (
    <span className="crm-source-badge">
      {labels[source] ?? source}
    </span>
  );
}

function ContactCard({
  contact,
  onStageChange,
  onSelect,
}: {
  contact: CrmContact;
  onStageChange: (id: string, stage: Stage) => void;
  onSelect: (contact: CrmContact) => void;
}) {
  const lastContact = contact.lastContactAt
    ? new Date(contact.lastContactAt).toLocaleDateString("en-ZA", {
        day: "numeric",
        month: "short",
      })
    : contact.createdAt
    ? new Date(contact.createdAt).toLocaleDateString("en-ZA", {
        day: "numeric",
        month: "short",
      })
    : null;

  return (
    <div
      className="crm-card"
      onClick={() => onSelect(contact)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect(contact);
      }}
    >
      <div className="crm-card-name">{contact.name}</div>
      <div className="crm-card-meta">
        {contact.phone && <div>{contact.phone}</div>}
        {contact.email && !contact.phone && (
          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {contact.email}
          </div>
        )}
        {lastContact && <div style={{ marginTop: 2 }}>{lastContact}</div>}
      </div>
      <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
        <SourceBadge source={contact.source} />
      </div>
      {/* Stage change dropdown — stops propagation so click does not open detail */}
      <select
        className="crm-stage-select"
        value={contact.stage}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          e.stopPropagation();
          onStageChange(contact.id, e.target.value as Stage);
        }}
        aria-label={`Move ${contact.name} to stage`}
      >
        {STAGES.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function DetailPanel({
  contact,
  onClose,
  onAddNote,
}: {
  contact: CrmContact;
  onClose: () => void;
  onAddNote: (id: string, note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textRef.current?.focus();
  }, []);

  async function handleAddNote() {
    if (!note.trim()) return;
    setSaving(true);
    try {
      await onAddNote(contact.id, note.trim());
      setNote("");
    } finally {
      setSaving(false);
    }
  }

  const waPhone = (contact.phone ?? "").replace(/\D/g, "");
  const waLink = waPhone ? `https://wa.me/${waPhone}` : null;
  const mailLink = contact.email ? `mailto:${contact.email}` : null;

  return (
    <div
      style={{
        position: "fixed",
        inset: "0 0 0 auto",
        width: "min(400px, 100vw)",
        background: "#fff",
        boxShadow: "-4px 0 32px rgba(17,34,56,0.14)",
        zIndex: 80,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
      role="dialog"
      aria-label={`Contact details for ${contact.name}`}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 18px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: "var(--heading)" }}>
            {contact.name}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            <SourceBadge source={contact.source} />
          </div>
        </div>
        <button
          className="ghost-button"
          style={{ minHeight: 32, padding: "0 10px", fontSize: 12 }}
          onClick={onClose}
          type="button"
        >
          Close
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px", display: "grid", gap: 14 }}>
        {/* Contact info */}
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              color: "var(--muted)",
              marginBottom: 6,
              letterSpacing: "0.05em",
            }}
          >
            Contact
          </div>
          {contact.phone && (
            <div style={{ fontSize: 13, marginBottom: 4, color: "var(--text)" }}>
              {contact.phone}
            </div>
          )}
          {contact.email && (
            <div style={{ fontSize: 13, color: "var(--text)", wordBreak: "break-all" }}>
              {contact.email}
            </div>
          )}
          {!contact.phone && !contact.email && (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>No contact info</div>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {waLink && (
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="primary-button"
              style={{ minHeight: 34, padding: "0 12px", fontSize: 12, textDecoration: "none" }}
            >
              WhatsApp
            </a>
          )}
          {mailLink && (
            <a
              href={mailLink}
              className="ghost-button"
              style={{ minHeight: 34, padding: "0 12px", fontSize: 12, textDecoration: "none" }}
            >
              Email
            </a>
          )}
        </div>

        {/* Stage */}
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              color: "var(--muted)",
              marginBottom: 4,
              letterSpacing: "0.05em",
            }}
          >
            Stage
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--heading)" }}>
            {STAGES.find((s) => s.key === contact.stage)?.label ?? contact.stage}
          </div>
        </div>

        {/* Notes history */}
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              color: "var(--muted)",
              marginBottom: 6,
              letterSpacing: "0.05em",
            }}
          >
            Notes
          </div>
          {contact.notes ? (
            <pre
              style={{
                margin: 0,
                padding: "10px 12px",
                borderRadius: 8,
                background: "#f8fafc",
                border: "1px solid var(--border)",
                fontSize: 12,
                lineHeight: 1.55,
                color: "var(--text)",
                whiteSpace: "pre-wrap",
                fontFamily: "inherit",
                maxHeight: 180,
                overflowY: "auto",
              }}
            >
              {contact.notes}
            </pre>
          ) : (
            <div style={{ fontSize: 12, color: "var(--muted)" }}>No notes yet.</div>
          )}
        </div>

        {/* Add note */}
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              color: "var(--muted)",
              marginBottom: 6,
              letterSpacing: "0.05em",
            }}
          >
            Add note
          </div>
          <textarea
            ref={textRef}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Type a note and press Save..."
            rows={3}
            style={{ fontSize: 13 }}
          />
          <button
            className="primary-button"
            style={{ marginTop: 8, minHeight: 34, padding: "0 14px", fontSize: 12 }}
            onClick={handleAddNote}
            disabled={saving || !note.trim()}
            type="button"
          >
            {saving ? "Saving..." : "Save note"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CrmDashboard() {
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<Source>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<CrmContact | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<AddContactForm>(EMPTY_FORM);
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState("");

  // Load contacts
  const fetchContacts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/crm");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { contacts: CrmContact[] };
      setContacts(data.contacts ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load contacts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchContacts();
  }, [fetchContacts]);

  // Stage change
  async function handleStageChange(id: string, stage: Stage) {
    // Optimistic update
    setContacts((prev) =>
      prev.map((c) => (c.id === id ? { ...c, stage } : c))
    );
    if (selected?.id === id) {
      setSelected((prev) => (prev ? { ...prev, stage } : prev));
    }
    try {
      const res = await fetch("/api/dashboard/crm", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, stage }),
      });
      if (!res.ok) {
        // Revert on failure
        void fetchContacts();
      }
    } catch {
      void fetchContacts();
    }
  }

  // Add note
  async function handleAddNote(id: string, note: string) {
    const res = await fetch("/api/dashboard/crm", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, note }),
    });
    if (!res.ok) throw new Error("Failed to save note");
    const updated = (await res.json()) as { contact: CrmContact };
    setContacts((prev) =>
      prev.map((c) => (c.id === id ? updated.contact : c))
    );
    setSelected(updated.contact);
  }

  // Add contact
  async function handleAddContact(e: React.FormEvent) {
    e.preventDefault();
    setAddError("");
    if (!addForm.name.trim()) {
      setAddError("Name is required.");
      return;
    }
    setAddSaving(true);
    try {
      const res = await fetch("/api/dashboard/crm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Failed to create contact");
      }
      const data = (await res.json()) as { contact: CrmContact };
      setContacts((prev) => [data.contact, ...prev]);
      setAddForm(EMPTY_FORM);
      setShowAddForm(false);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Error");
    } finally {
      setAddSaving(false);
    }
  }

  // Filtering
  const filtered = contacts.filter((c) => {
    if (sourceFilter !== "all" && c.source !== sourceFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      if (
        !c.name.toLowerCase().includes(q) &&
        !(c.phone ?? "").toLowerCase().includes(q) &&
        !(c.email ?? "").toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  const byStage = (stage: Stage) => filtered.filter((c) => c.stage === stage);

  return (
    <section style={{ padding: "0 0 32px" }}>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <input
          type="search"
          placeholder="Search by name or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 240, fontSize: 13 }}
          aria-label="Search contacts"
        />

        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {SOURCES.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`ghost-button${sourceFilter === s.key ? " is-active" : ""}`}
              style={{
                minHeight: 32,
                padding: "0 10px",
                fontSize: 12,
                ...(sourceFilter === s.key
                  ? { borderColor: "var(--blue)", color: "var(--blue)", background: "var(--soft-blue)" }
                  : {}),
              }}
              onClick={() => setSourceFilter(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="primary-button"
          style={{ minHeight: 34, padding: "0 14px", fontSize: 12, marginLeft: "auto" }}
          onClick={() => setShowAddForm((v) => !v)}
        >
          {showAddForm ? "Cancel" : "+ Add contact"}
        </button>
      </div>

      {/* Add contact inline form */}
      {showAddForm && (
        <form
          onSubmit={handleAddContact}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr auto auto",
            gap: 8,
            alignItems: "end",
            marginBottom: 16,
            padding: "14px 16px",
            border: "1px solid var(--border)",
            borderRadius: 10,
            background: "#fff",
            flexWrap: "wrap",
          }}
        >
          <label>
            Name *
            <input
              type="text"
              value={addForm.name}
              onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Jane Dlamini"
              required
              style={{ fontSize: 13 }}
            />
          </label>
          <label>
            Phone
            <input
              type="tel"
              value={addForm.phone}
              onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="+27..."
              style={{ fontSize: 13 }}
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={addForm.email}
              onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="jane@..."
              style={{ fontSize: 13 }}
            />
          </label>
          <label>
            Source
            <select
              className="crm-stage-select"
              value={addForm.source}
              onChange={(e) => setAddForm((f) => ({ ...f, source: e.target.value }))}
              style={{ height: 38 }}
            >
              <option value="manual">Manual</option>
              <option value="lead-form">Lead form</option>
              <option value="booking">Booking</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
          </label>
          <button
            type="submit"
            className="primary-button"
            style={{ minHeight: 34, padding: "0 14px", fontSize: 12 }}
            disabled={addSaving}
          >
            {addSaving ? "Saving..." : "Add"}
          </button>
          {addError && (
            <p
              className="field-error"
              style={{ gridColumn: "1 / -1", margin: 0 }}
            >
              {addError}
            </p>
          )}
        </form>
      )}

      {/* Error / loading states */}
      {error && (
        <p style={{ color: "#b42318", fontSize: 13, margin: "0 0 12px" }}>
          {error}{" "}
          <button
            type="button"
            className="ghost-button"
            style={{ minHeight: 28, padding: "0 10px", fontSize: 12 }}
            onClick={fetchContacts}
          >
            Retry
          </button>
        </p>
      )}
      {loading && (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading contacts...</p>
      )}

      {/* Kanban board */}
      {!loading && !error && (
        <div className="crm-pipeline" role="region" aria-label="CRM pipeline">
          {STAGES.map((stage) => {
            const stageContacts = byStage(stage.key);
            return (
              <div key={stage.key} className="crm-col">
                <div className="crm-col-header">
                  <span style={{ color: stage.color }}>{stage.label}</span>
                  <span
                    style={{
                      background: stage.color + "22",
                      color: stage.color,
                      borderRadius: "999px",
                      padding: "1px 7px",
                      fontSize: 11,
                      fontWeight: 800,
                    }}
                  >
                    {stageContacts.length}
                  </span>
                </div>

                {stageContacts.length === 0 ? (
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--muted)",
                      textAlign: "center",
                      padding: "20px 0",
                      borderRadius: 8,
                      border: "1px dashed var(--border)",
                    }}
                  >
                    No contacts
                  </div>
                ) : (
                  stageContacts.map((c) => (
                    <ContactCard
                      key={c.id}
                      contact={c}
                      onStageChange={handleStageChange}
                      onSelect={setSelected}
                    />
                  ))
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Detail slide-out */}
      {selected && (
        <>
          {/* Overlay */}
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(17,34,56,0.28)",
              zIndex: 79,
            }}
            onClick={() => setSelected(null)}
            aria-hidden="true"
          />
          <DetailPanel
            contact={selected}
            onClose={() => setSelected(null)}
            onAddNote={handleAddNote}
          />
        </>
      )}
    </section>
  );
}
