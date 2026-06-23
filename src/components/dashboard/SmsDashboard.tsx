"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SmsHistoryEntry {
  id: string;
  date: string;
  recipientCount: number;
  messagePreview: string;
  status: "sent" | "partial" | "failed";
  sent: number;
  failed: number;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

interface SmsTemplate {
  id: string;
  label: string;
  body: string;
}

const SMS_TEMPLATES: SmsTemplate[] = [
  {
    id: "appointment",
    label: "Appointment reminder",
    body: "Hi {name}, reminder of your appointment on {date} at {time} at {businessName}. Reply STOP to opt out.",
  },
  {
    id: "offer",
    label: "Special offer",
    body: "Exclusive offer from {businessName}: [your message here]. Reply STOP to opt out.",
  },
  {
    id: "thankyou",
    label: "Thank you",
    body: "Thank you for visiting {businessName}! We hope to see you again soon. Reply STOP to opt out.",
  },
];

const SMS_MAX_CHARS = 160;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseNumbers(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function statusColour(status: SmsHistoryEntry["status"]): React.CSSProperties {
  if (status === "sent") return { background: "#f0fdf4", color: "#0f7a4f" };
  if (status === "partial") return { background: "#fffbeb", color: "#92400e" };
  return { background: "#fdecea", color: "#b42318" };
}

function StatusBadge({ status }: { status: SmsHistoryEntry["status"] }) {
  const labels: Record<SmsHistoryEntry["status"], string> = {
    sent: "Sent",
    partial: "Partial",
    failed: "Failed",
  };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 800,
        ...statusColour(status),
      }}
    >
      {labels[status]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SmsDashboard() {
  // --- Quick send ---
  const [quickRecipient, setQuickRecipient] = useState("");
  const [quickMessage, setQuickMessage] = useState("");
  const [quickSending, setQuickSending] = useState(false);
  const [quickResult, setQuickResult] = useState<string>("");

  // --- Bulk send ---
  const [bulkMode, setBulkMode] = useState<"numbers" | "all_crm">("numbers");
  const [bulkNumbers, setBulkNumbers] = useState("");
  const [bulkMessage, setBulkMessage] = useState("");
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkResult, setBulkResult] = useState<string>("");

  // --- History (local, accumulated this session) ---
  const [history, setHistory] = useState<SmsHistoryEntry[]>([]);

  // --- Opt-out list (server-side + local additions) ---
  const [optOuts, setOptOuts] = useState<string[]>([]);
  const [optOutLoading, setOptOutLoading] = useState(false);

  // --- Tab ---
  const [tab, setTab] = useState<"quick" | "bulk" | "history" | "optouts">("quick");

  const historyId = useRef(0);

  // ---------------------------------------------------------------------------
  // Load opt-outs on mount
  // ---------------------------------------------------------------------------

  const fetchOptOuts = useCallback(async () => {
    setOptOutLoading(true);
    try {
      const res = await fetch("/api/sms/optouts");
      if (res.ok) {
        const data = (await res.json()) as { optOuts: string[] };
        setOptOuts(data.optOuts ?? []);
      }
    } catch {
      // non-fatal
    } finally {
      setOptOutLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOptOuts();
  }, [fetchOptOuts]);

  // ---------------------------------------------------------------------------
  // Quick send
  // ---------------------------------------------------------------------------

  async function handleQuickSend() {
    const phone = quickRecipient.trim();
    const msg = quickMessage.trim();
    if (!phone || !msg) {
      setQuickResult("Recipient and message are required.");
      return;
    }
    setQuickSending(true);
    setQuickResult("");
    try {
      const res = await fetch("/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: phone, message: msg }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        sent?: number;
        failed?: number;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !data.ok) {
        setQuickResult(data.detail ?? data.error ?? "Send failed.");
      } else {
        setQuickResult(`Sent to ${data.sent ?? 1} recipient.`);
        addHistory(msg, 1, data.sent ?? 0, data.failed ?? 0);
        setQuickMessage("");
        setQuickRecipient("");
      }
    } catch (err) {
      setQuickResult(err instanceof Error ? err.message : "Send failed.");
    } finally {
      setQuickSending(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Bulk send
  // ---------------------------------------------------------------------------

  async function handleBulkSend() {
    const msg = bulkMessage.trim();
    if (!msg) {
      setBulkResult("Message is required.");
      return;
    }

    let recipients: string[];
    if (bulkMode === "all_crm") {
      // Fetch CRM contacts to get their numbers
      try {
        const res = await fetch("/api/dashboard/crm");
        if (!res.ok) throw new Error("Failed to load CRM contacts");
        const data = (await res.json()) as {
          contacts?: Array<{ phone?: string | null }>;
        };
        recipients = (data.contacts ?? [])
          .map((c) => c.phone ?? "")
          .filter(Boolean) as string[];
        if (recipients.length === 0) {
          setBulkResult("No phone numbers found in CRM contacts.");
          return;
        }
      } catch (err) {
        setBulkResult(err instanceof Error ? err.message : "Could not load contacts.");
        return;
      }
    } else {
      recipients = parseNumbers(bulkNumbers);
      if (recipients.length === 0) {
        setBulkResult("Enter at least one phone number.");
        return;
      }
    }

    setBulkSending(true);
    setBulkResult("");
    try {
      const res = await fetch("/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: recipients, message: msg }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        sent?: number;
        failed?: number;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !data.ok) {
        setBulkResult(data.detail ?? data.error ?? "Send failed.");
      } else {
        const sent = data.sent ?? 0;
        const failed = data.failed ?? 0;
        setBulkResult(
          `Sent to ${sent} recipient${sent !== 1 ? "s" : ""}${failed > 0 ? `. ${failed} failed or opted out.` : "."}`,
        );
        addHistory(msg, recipients.length, sent, failed);
        setBulkMessage("");
        setBulkNumbers("");
      }
    } catch (err) {
      setBulkResult(err instanceof Error ? err.message : "Send failed.");
    } finally {
      setBulkSending(false);
    }
  }

  // ---------------------------------------------------------------------------
  // History helper
  // ---------------------------------------------------------------------------

  function addHistory(msg: string, total: number, sent: number, failed: number) {
    const status: SmsHistoryEntry["status"] =
      sent === 0 ? "failed" : failed > 0 ? "partial" : "sent";
    setHistory((prev) => [
      {
        id: String(++historyId.current),
        date: new Date().toISOString(),
        recipientCount: total,
        messagePreview: msg.length > 60 ? msg.slice(0, 57) + "..." : msg,
        status,
        sent,
        failed,
      },
      ...prev,
    ]);
  }

  // ---------------------------------------------------------------------------
  // Template apply
  // ---------------------------------------------------------------------------

  function applyTemplate(tpl: SmsTemplate, target: "quick" | "bulk") {
    if (target === "quick") {
      setQuickMessage(tpl.body);
      setQuickResult("");
    } else {
      setBulkMessage(tpl.body);
      setBulkResult("");
    }
  }

  // ---------------------------------------------------------------------------
  // Opt-out removal (UI only — server-side managed via addOptOut/removeOptOut)
  // ---------------------------------------------------------------------------

  function removeOptOut(phone: string) {
    setOptOuts((prev) => prev.filter((p) => p !== phone));
    // Fire-and-forget to backend (best-effort)
    void fetch("/api/sms/optouts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const isResultError = (msg: string) =>
    msg.includes("required") ||
    msg.includes("failed") ||
    msg.includes("error") ||
    msg.includes("limited") ||
    msg.includes("plan");

  function ResultBanner({ msg }: { msg: string }) {
    if (!msg) return null;
    const isErr = isResultError(msg);
    return (
      <div
        style={{
          marginTop: 10,
          padding: "9px 12px",
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 600,
          background: isErr ? "#fdecea" : "#f0fdf4",
          color: isErr ? "#b42318" : "#0f7a4f",
        }}
      >
        {msg}
      </div>
    );
  }

  function SmsCharCount({ value }: { value: string }) {
    const len = value.length;
    const over = len > SMS_MAX_CHARS;
    const parts = len === 0 ? 0 : Math.ceil(len / SMS_MAX_CHARS);
    return (
      <div
        className="sms-char-count"
        style={{ color: over ? "#b42318" : undefined }}
      >
        {len}/{SMS_MAX_CHARS}
        {parts > 1 ? ` (${parts} messages)` : ""}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Tab nav
  // ---------------------------------------------------------------------------

  const TABS: Array<{ id: typeof tab; label: string }> = [
    { id: "quick", label: "Quick send" },
    { id: "bulk", label: "Bulk send" },
    { id: "history", label: `History${history.length ? ` (${history.length})` : ""}` },
    { id: "optouts", label: `Opt-outs${optOuts.length ? ` (${optOuts.length})` : ""}` },
  ];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <section style={{ paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 22, color: "var(--heading)" }}>
          SMS Messaging
        </h2>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
          Send SMS to customers via Africa&apos;s Talking. POPIA-compliant with automatic
          opt-out management.
        </p>
      </div>

      {/* Tab nav */}
      <div
        style={{
          display: "flex",
          gap: 4,
          borderBottom: "1px solid var(--border)",
          marginBottom: 20,
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{
              padding: "8px 14px",
              border: "none",
              background: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: tab === t.id ? 700 : 500,
              color: tab === t.id ? "var(--heading)" : "var(--muted)",
              borderBottom: tab === t.id ? "2px solid var(--blue)" : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ---------- QUICK SEND ---------- */}
      {tab === "quick" && (
        <div>
          {/* Templates */}
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--muted)",
                marginBottom: 8,
              }}
            >
              Quick templates
            </div>
            <div className="sms-templates">
              {SMS_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="sms-template-btn"
                  onClick={() => applyTemplate(t, "quick")}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="sms-compose">
            <div style={{ display: "grid", gap: 12 }}>
              <label>
                <span
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 700,
                    color: "var(--muted)",
                    marginBottom: 4,
                  }}
                >
                  Recipient (phone or name)
                </span>
                <input
                  type="text"
                  value={quickRecipient}
                  onChange={(e) => setQuickRecipient(e.target.value)}
                  placeholder="+27 82 000 0000"
                />
              </label>

              <div>
                <span
                  style={{
                    display: "block",
                    fontSize: 12,
                    fontWeight: 700,
                    color: "var(--muted)",
                    marginBottom: 4,
                  }}
                >
                  Message
                </span>
                <textarea
                  value={quickMessage}
                  onChange={(e) => setQuickMessage(e.target.value)}
                  placeholder="Type your message..."
                  style={{ minHeight: 90, resize: "vertical" }}
                />
                <SmsCharCount value={quickMessage} />
              </div>

              <div>
                <button
                  type="button"
                  className="primary-button"
                  onClick={handleQuickSend}
                  disabled={quickSending || !quickRecipient.trim() || !quickMessage.trim()}
                >
                  {quickSending ? "Sending..." : "Send SMS"}
                </button>
              </div>
            </div>

            <ResultBanner msg={quickResult} />
          </div>
        </div>
      )}

      {/* ---------- BULK SEND ---------- */}
      {tab === "bulk" && (
        <div>
          {/* Templates */}
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--muted)",
                marginBottom: 8,
              }}
            >
              Quick templates
            </div>
            <div className="sms-templates">
              {SMS_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="sms-template-btn"
                  onClick={() => applyTemplate(t, "bulk")}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="sms-compose">
            {/* Recipient mode */}
            <div style={{ marginBottom: 12 }}>
              <span
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--muted)",
                  marginBottom: 6,
                }}
              >
                Recipients
              </span>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <button
                  type="button"
                  className="ghost-button"
                  style={{
                    minHeight: 34,
                    padding: "0 14px",
                    fontSize: 13,
                    ...(bulkMode === "numbers"
                      ? { borderColor: "var(--blue)", color: "var(--blue)", background: "var(--soft-blue)" }
                      : {}),
                  }}
                  onClick={() => setBulkMode("numbers")}
                >
                  Enter numbers
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  style={{
                    minHeight: 34,
                    padding: "0 14px",
                    fontSize: 13,
                    ...(bulkMode === "all_crm"
                      ? { borderColor: "var(--blue)", color: "var(--blue)", background: "var(--soft-blue)" }
                      : {}),
                  }}
                  onClick={() => setBulkMode("all_crm")}
                >
                  All CRM contacts
                </button>
              </div>

              {bulkMode === "numbers" && (
                <textarea
                  value={bulkNumbers}
                  onChange={(e) => setBulkNumbers(e.target.value)}
                  placeholder="+27 82 000 0000&#10;+27 83 111 1111&#10;+27 84 222 2222"
                  style={{ minHeight: 100, resize: "vertical", fontSize: 13 }}
                />
              )}
              {bulkMode === "all_crm" && (
                <div
                  style={{
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: "var(--soft-blue)",
                    color: "var(--blue)",
                    fontSize: 13,
                  }}
                >
                  All CRM contacts with a phone number will be included. Opted-out
                  contacts are automatically excluded.
                </div>
              )}
            </div>

            {/* Message */}
            <div style={{ marginBottom: 12 }}>
              <span
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "var(--muted)",
                  marginBottom: 4,
                }}
              >
                Message
              </span>
              <textarea
                value={bulkMessage}
                onChange={(e) => setBulkMessage(e.target.value)}
                placeholder="Type your message..."
                style={{ minHeight: 90, resize: "vertical" }}
              />
              <SmsCharCount value={bulkMessage} />
            </div>

            <button
              type="button"
              className="primary-button"
              onClick={handleBulkSend}
              disabled={bulkSending || !bulkMessage.trim()}
            >
              {bulkSending ? "Sending..." : "Send to all"}
            </button>

            <ResultBanner msg={bulkResult} />
          </div>
        </div>
      )}

      {/* ---------- HISTORY ---------- */}
      {tab === "history" && (
        <div>
          {history.length === 0 ? (
            <div
              style={{
                padding: "32px 0",
                textAlign: "center",
                color: "var(--muted)",
                fontSize: 13,
                border: "1px dashed var(--border)",
                borderRadius: 10,
              }}
            >
              No SMS sent yet this session. Send your first message above.
            </div>
          ) : (
            <div>
              {history.map((entry) => (
                <div key={entry.id} className="sms-history-row">
                  <span style={{ color: "var(--muted)", minWidth: 140 }}>
                    {new Date(entry.date).toLocaleString("en-ZA", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {entry.messagePreview}
                  </span>
                  <span style={{ color: "var(--muted)", minWidth: 100, textAlign: "right" }}>
                    {entry.sent}/{entry.recipientCount} delivered
                  </span>
                  <span style={{ minWidth: 70, textAlign: "right" }}>
                    <StatusBadge status={entry.status} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---------- OPT-OUTS ---------- */}
      {tab === "optouts" && (
        <div>
          <div style={{ marginBottom: 12 }}>
            <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--muted)" }}>
              Contacts who replied STOP are listed here. They are automatically
              excluded from all outbound SMS. Removing a number from this list
              re-enables sending — only do so if the contact has explicitly re-consented.
            </p>
            <button
              type="button"
              className="ghost-button"
              style={{ minHeight: 28, padding: "0 10px", fontSize: 12 }}
              onClick={fetchOptOuts}
              disabled={optOutLoading}
            >
              {optOutLoading ? "Loading..." : "Refresh"}
            </button>
          </div>

          {optOuts.length === 0 ? (
            <div
              style={{
                padding: "28px 0",
                textAlign: "center",
                color: "var(--muted)",
                fontSize: 13,
                border: "1px dashed var(--border)",
                borderRadius: 10,
              }}
            >
              No opted-out numbers yet.
            </div>
          ) : (
            <div>
              {optOuts.map((phone) => (
                <div
                  key={phone}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 0",
                    borderBottom: "1px solid var(--border)",
                    fontSize: 13,
                  }}
                >
                  <span>{phone}</span>
                  <button
                    type="button"
                    className="ghost-button"
                    style={{ minHeight: 26, padding: "0 10px", fontSize: 12, color: "#b42318" }}
                    onClick={() => removeOptOut(phone)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
