"use client";

import { useCallback, useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CampaignStatus = "draft" | "scheduled" | "sending" | "sent";

interface Campaign {
  id: string;
  name: string;
  subject: string;
  bodyHtml: string;
  status: CampaignStatus;
  scheduledAt: string | null;
  sentAt: string | null;
  recipientCount: number;
  openCount: number;
  clickCount: number;
  createdAt: string;
}

type AudienceType = "all_leads" | "contacted_leads" | "all_bookings" | "custom";

interface ComposerState {
  name: string;
  subject: string;
  bodyHtml: string;
  audience: AudienceType;
  customList: string;
  scheduleMode: "now" | "later";
  scheduledAt: string;
  previewMode: boolean;
}

const EMPTY_COMPOSER: ComposerState = {
  name: "",
  subject: "",
  bodyHtml: "",
  audience: "all_leads",
  customList: "",
  scheduleMode: "now",
  scheduledAt: "",
  previewMode: false,
};

// ---------------------------------------------------------------------------
// Quick templates
// ---------------------------------------------------------------------------

const TEMPLATES = [
  {
    id: "newsletter",
    title: "Monthly newsletter",
    desc: "Recap news, tips, and offers from the past month.",
    name: "Monthly Newsletter",
    subject: "This month at [Business Name] — news + exclusive offer",
    bodyHtml: `<h2>Hello from [Business Name]!</h2>
<p>Here's what's been happening this month and what's coming up next.</p>
<h3>What's new</h3>
<p>We've been busy serving our community and expanding our offerings. Thank you for your continued support.</p>
<h3>Special offer just for you</h3>
<p>As a valued customer, enjoy <strong>10% off</strong> your next booking this month. Use code <strong>LOYAL10</strong>.</p>
<p>Book now: <a href="#">Click here to book</a></p>
<p>Until next month,<br>[Business Name] Team</p>`,
  },
  {
    id: "special-offer",
    title: "Special offer",
    desc: "Time-limited discount or promotion to drive bookings.",
    name: "Special Offer Campaign",
    subject: "Limited time: 20% off — this week only",
    bodyHtml: `<h2>Exclusive offer for you!</h2>
<p>We're running a special promotion and you're among the first to know.</p>
<div style="background:#f0fdf4;border-left:4px solid #0f7a4f;padding:16px;margin:16px 0;border-radius:6px;">
  <strong style="font-size:20px;">20% OFF</strong><br>
  <span>Valid this week only. Limited slots available.</span>
</div>
<p><a href="#" style="background:#0f7a4f;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Book Now</a></p>
<p style="color:#667085;font-size:12px;">Offer expires Sunday. Cannot be combined with other promotions.</p>`,
  },
  {
    id: "new-service",
    title: "New service announcement",
    desc: "Announce a new service or product to your customers.",
    name: "New Service Announcement",
    subject: "Exciting news: We're now offering [New Service]",
    bodyHtml: `<h2>We've added something new!</h2>
<p>We're thrilled to announce the launch of our newest service.</p>
<h3>[New Service Name]</h3>
<p>Designed with you in mind, this service offers:</p>
<ul>
  <li>Benefit one — saving you time and money</li>
  <li>Benefit two — tailored to your specific needs</li>
  <li>Benefit three — available immediately</li>
</ul>
<p>As one of our valued customers, you get <strong>first access</strong>.</p>
<p><a href="#">Learn more and book your spot</a></p>
<p>Questions? Just reply to this email — we're happy to help.</p>`,
  },
] as const;

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: CampaignStatus }) {
  const map: Record<CampaignStatus, { label: string; style: React.CSSProperties }> = {
    draft: { label: "Draft", style: { background: "#f3f6f8", color: "#667085" } },
    scheduled: { label: "Scheduled", style: { background: "#fffbeb", color: "#92400e" } },
    sending: { label: "Sending", style: { background: "#eff6ff", color: "#1d4ed8" } },
    sent: { label: "Sent", style: { background: "#f0fdf4", color: "#0f7a4f" } },
  };
  const { label, style } = map[status] ?? map.draft;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 800,
        ...style,
      }}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Campaign card
// ---------------------------------------------------------------------------

function CampaignCard({
  campaign,
  onEdit,
  onDuplicate,
  onSend,
}: {
  campaign: Campaign;
  onEdit: (c: Campaign) => void;
  onDuplicate: (c: Campaign) => void;
  onSend: (id: string) => void;
}) {
  const openRate =
    campaign.recipientCount > 0
      ? ((campaign.openCount / campaign.recipientCount) * 100).toFixed(1)
      : "—";
  const clickRate =
    campaign.recipientCount > 0
      ? ((campaign.clickCount / campaign.recipientCount) * 100).toFixed(1)
      : "—";

  const scheduledDate =
    campaign.scheduledAt
      ? new Date(campaign.scheduledAt).toLocaleString("en-ZA", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

  return (
    <div className="email-campaign-card">
      <div className="email-campaign-header">
        <div>
          <div className="email-campaign-name">{campaign.name}</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            {campaign.subject}
          </div>
        </div>
        <StatusBadge status={campaign.status} />
      </div>

      <div className="email-campaign-stats">
        <span className="email-stat">
          Recipients: <strong>{campaign.recipientCount}</strong>
        </span>
        <span className="email-stat">
          Open rate: <strong>{typeof openRate === "string" ? openRate + (openRate !== "—" ? "%" : "") : openRate}</strong>
        </span>
        <span className="email-stat">
          Click rate: <strong>{typeof clickRate === "string" ? clickRate + (clickRate !== "—" ? "%" : "") : clickRate}</strong>
        </span>
        {scheduledDate && (
          <span className="email-stat">
            Scheduled: <strong>{scheduledDate}</strong>
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        {campaign.status === "draft" && (
          <>
            <button
              type="button"
              className="ghost-button"
              style={{ minHeight: 28, padding: "0 10px", fontSize: 12 }}
              onClick={() => onEdit(campaign)}
            >
              Edit
            </button>
            <button
              type="button"
              className="primary-button"
              style={{ minHeight: 28, padding: "0 10px", fontSize: 12 }}
              onClick={() => onSend(campaign.id)}
            >
              Send now
            </button>
          </>
        )}
        <button
          type="button"
          className="ghost-button"
          style={{ minHeight: 28, padding: "0 10px", fontSize: 12 }}
          onClick={() => onDuplicate(campaign)}
        >
          Duplicate
        </button>
        {campaign.status === "sent" && (
          <button
            type="button"
            className="ghost-button"
            style={{ minHeight: 28, padding: "0 10px", fontSize: 12 }}
            onClick={() => onEdit(campaign)}
          >
            View report
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard
// ---------------------------------------------------------------------------

export function EmailMarketingDashboard() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Composer state
  const [showComposer, setShowComposer] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [composer, setComposer] = useState<ComposerState>(EMPTY_COMPOSER);

  // AI states
  const [subjectSuggestions, setSubjectSuggestions] = useState<string[]>([]);
  const [improvingSubject, setImprovingSubject] = useState(false);
  const [generatingBody, setGeneratingBody] = useState(false);

  // Send state
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [sendStatus, setSendStatus] = useState<string>("");

  // Save state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // ---------------------------------------------------------------------------
  // Load campaigns
  // ---------------------------------------------------------------------------

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/email/campaigns");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { campaigns: Campaign[] };
      setCampaigns(data.campaigns ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load campaigns");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCampaigns();
  }, [fetchCampaigns]);

  // ---------------------------------------------------------------------------
  // Composer helpers
  // ---------------------------------------------------------------------------

  function openNewComposer() {
    setEditingId(null);
    setComposer(EMPTY_COMPOSER);
    setSubjectSuggestions([]);
    setSaveError("");
    setShowComposer(true);
  }

  function openEditComposer(campaign: Campaign) {
    setEditingId(campaign.id);
    setComposer({
      name: campaign.name,
      subject: campaign.subject,
      bodyHtml: campaign.bodyHtml,
      audience: "all_leads",
      customList: "",
      scheduleMode: campaign.scheduledAt ? "later" : "now",
      scheduledAt: campaign.scheduledAt
        ? new Date(campaign.scheduledAt).toISOString().slice(0, 16)
        : "",
      previewMode: false,
    });
    setSubjectSuggestions([]);
    setSaveError("");
    setShowComposer(true);
  }

  function applyTemplate(t: typeof TEMPLATES[number]) {
    setComposer((prev) => ({
      ...prev,
      name: t.name,
      subject: t.subject,
      bodyHtml: t.bodyHtml,
      previewMode: false,
    }));
    setSubjectSuggestions([]);
    setShowComposer(true);
    setEditingId(null);
  }

  function duplicateCampaign(campaign: Campaign) {
    setEditingId(null);
    setComposer({
      name: `${campaign.name} (copy)`,
      subject: campaign.subject,
      bodyHtml: campaign.bodyHtml,
      audience: "all_leads",
      customList: "",
      scheduleMode: "now",
      scheduledAt: "",
      previewMode: false,
    });
    setSubjectSuggestions([]);
    setSaveError("");
    setShowComposer(true);
  }

  // ---------------------------------------------------------------------------
  // AI — improve subject
  // ---------------------------------------------------------------------------

  async function handleImproveSubject() {
    if (!composer.subject.trim()) return;
    setImprovingSubject(true);
    setSubjectSuggestions([]);
    try {
      const res = await fetch("/api/email/improve-subject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: composer.subject,
          businessName: "your business",
          industry: "business",
        }),
      });
      if (!res.ok) throw new Error("Failed");
      const data = (await res.json()) as { subjects?: string[] };
      setSubjectSuggestions(data.subjects ?? []);
    } catch {
      // silently fail — suggestions just won't show
    } finally {
      setImprovingSubject(false);
    }
  }

  // ---------------------------------------------------------------------------
  // AI — generate body
  // ---------------------------------------------------------------------------

  async function handleGenerateBody() {
    setGeneratingBody(true);
    try {
      const res = await fetch("/api/email/generate-body", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: "your business",
          industry: "business",
          topic: composer.name || "general update",
          tone: "professional",
        }),
      });
      if (!res.ok) throw new Error("Failed");
      const data = (await res.json()) as { html?: string };
      if (data.html) {
        setComposer((prev) => ({ ...prev, bodyHtml: data.html!, previewMode: false }));
      }
    } catch {
      // silently fail
    } finally {
      setGeneratingBody(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Save campaign (create or update)
  // ---------------------------------------------------------------------------

  async function handleSave() {
    if (!composer.name.trim() || !composer.subject.trim() || !composer.bodyHtml.trim()) {
      setSaveError("Campaign name, subject, and body are required.");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const payload = {
        name: composer.name.trim(),
        subject: composer.subject.trim(),
        bodyHtml: composer.bodyHtml,
        scheduledAt:
          composer.scheduleMode === "later" && composer.scheduledAt
            ? new Date(composer.scheduledAt).toISOString()
            : null,
      };

      if (editingId) {
        const res = await fetch(`/api/email/campaigns?id=${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Failed to update");
        const data = (await res.json()) as { campaign: Campaign };
        setCampaigns((prev) =>
          prev.map((c) => (c.id === editingId ? data.campaign : c))
        );
      } else {
        const res = await fetch("/api/email/campaigns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Failed to create");
        const data = (await res.json()) as { campaign: Campaign };
        setCampaigns((prev) => [data.campaign, ...prev]);
      }

      setShowComposer(false);
      setEditingId(null);
      setComposer(EMPTY_COMPOSER);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Send campaign
  // ---------------------------------------------------------------------------

  async function handleSend(campaignId: string) {
    setSendingId(campaignId);
    setSendStatus("");
    try {
      const res = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId }),
      });
      const data = (await res.json()) as { sent?: number; error?: string };
      if (!res.ok) {
        setSendStatus(data.error ?? "Send failed");
      } else {
        setSendStatus(`Sent to ${data.sent ?? 0} recipients.`);
        void fetchCampaigns();
      }
    } catch (err) {
      setSendStatus(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSendingId(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <section style={{ paddingBottom: 40 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 20,
        }}
      >
        <div>
          <h2 style={{ margin: "0 0 4px", fontSize: 22, color: "var(--heading)" }}>
            Email Marketing
          </h2>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
            Create, schedule, and track email campaigns for your customers.
          </p>
        </div>
        <button
          type="button"
          className="primary-button"
          onClick={openNewComposer}
          style={{ whiteSpace: "nowrap" }}
        >
          + New campaign
        </button>
      </div>

      {/* Send status notice */}
      {sendStatus && (
        <div
          style={{
            marginBottom: 14,
            padding: "10px 14px",
            borderRadius: 8,
            background: sendStatus.includes("failed") || sendStatus.includes("error")
              ? "#fdecea"
              : "#f0fdf4",
            color: sendStatus.includes("failed") || sendStatus.includes("error")
              ? "#b42318"
              : "#0f7a4f",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {sendStatus}
          <button
            type="button"
            onClick={() => setSendStatus("")}
            style={{
              marginLeft: 10,
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "inherit",
              fontWeight: 700,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Quick templates */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "var(--muted)",
            marginBottom: 10,
          }}
        >
          Quick templates
        </div>
        <div className="email-template-grid">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              className="email-template-card"
              onClick={() => applyTemplate(t)}
            >
              <div className="email-template-title">{t.title}</div>
              <div className="email-template-desc">{t.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Composer */}
      {showComposer && (
        <div
          style={{
            marginBottom: 24,
            padding: 20,
            border: "1px solid var(--border)",
            borderRadius: 12,
            background: "#ffffff",
            boxShadow: "0 4px 20px rgba(17,34,56,0.07)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 16,
            }}
          >
            <strong style={{ fontSize: 15, color: "var(--heading)" }}>
              {editingId ? "Edit campaign" : "New campaign"}
            </strong>
            <button
              type="button"
              className="ghost-button"
              style={{ minHeight: 28, padding: "0 10px", fontSize: 12 }}
              onClick={() => {
                setShowComposer(false);
                setEditingId(null);
                setComposer(EMPTY_COMPOSER);
                setSaveError("");
                setSubjectSuggestions([]);
              }}
            >
              Cancel
            </button>
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            {/* Campaign name */}
            <label>
              Campaign name
              <input
                type="text"
                value={composer.name}
                onChange={(e) =>
                  setComposer((p) => ({ ...p, name: e.target.value }))
                }
                placeholder="e.g. June newsletter"
              />
            </label>

            {/* Subject + AI improve */}
            <label>
              Subject line
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="text"
                  value={composer.subject}
                  onChange={(e) =>
                    setComposer((p) => ({ ...p, subject: e.target.value }))
                  }
                  placeholder="e.g. Big news from our team this month"
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="ghost-button"
                  style={{ minHeight: 38, padding: "0 12px", fontSize: 12, whiteSpace: "nowrap" }}
                  onClick={handleImproveSubject}
                  disabled={improvingSubject || !composer.subject.trim()}
                >
                  {improvingSubject ? "Thinking..." : "AI Improve"}
                </button>
              </div>
            </label>

            {/* AI subject suggestions */}
            {subjectSuggestions.length > 0 && (
              <div
                style={{
                  padding: "10px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  background: "#f8fafc",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--muted)",
                    textTransform: "uppercase",
                    marginBottom: 8,
                  }}
                >
                  Suggested subject lines — click to use
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  {subjectSuggestions.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        setComposer((p) => ({ ...p, subject: s }));
                        setSubjectSuggestions([]);
                      }}
                      style={{
                        textAlign: "left",
                        padding: "7px 10px",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        background: "#fff",
                        color: "var(--heading)",
                        fontSize: 13,
                        cursor: "pointer",
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Body */}
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 6,
                }}
              >
                <label style={{ display: "block", color: "var(--muted)", fontSize: 12, fontWeight: 720 }}>
                  Email body (HTML)
                </label>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    className="ghost-button"
                    style={{ minHeight: 28, padding: "0 10px", fontSize: 12 }}
                    onClick={handleGenerateBody}
                    disabled={generatingBody}
                  >
                    {generatingBody ? "Generating..." : "Generate with AI"}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    style={{
                      minHeight: 28,
                      padding: "0 10px",
                      fontSize: 12,
                      ...(composer.previewMode
                        ? { borderColor: "var(--blue)", color: "var(--blue)", background: "var(--soft-blue)" }
                        : {}),
                    }}
                    onClick={() =>
                      setComposer((p) => ({ ...p, previewMode: !p.previewMode }))
                    }
                  >
                    {composer.previewMode ? "Edit" : "Preview"}
                  </button>
                </div>
              </div>

              {composer.previewMode ? (
                <div
                  style={{
                    minHeight: 200,
                    padding: 16,
                    border: "1px solid var(--border)",
                    borderRadius: 7,
                    background: "#ffffff",
                    fontSize: 14,
                    lineHeight: 1.6,
                  }}
                  dangerouslySetInnerHTML={{ __html: composer.bodyHtml }}
                />
              ) : (
                <textarea
                  value={composer.bodyHtml}
                  onChange={(e) =>
                    setComposer((p) => ({ ...p, bodyHtml: e.target.value }))
                  }
                  placeholder="Paste or write your HTML email body here..."
                  style={{ minHeight: 200, fontSize: 13, fontFamily: "monospace" }}
                />
              )}
            </div>

            {/* Audience */}
            <label>
              Audience
              <select
                value={composer.audience}
                onChange={(e) =>
                  setComposer((p) => ({ ...p, audience: e.target.value as AudienceType }))
                }
                style={{
                  height: 38,
                  width: "100%",
                  border: "1px solid var(--border)",
                  borderRadius: 7,
                  padding: "0 10px",
                  fontSize: 13,
                  background: "#fff",
                  color: "var(--heading)",
                }}
              >
                <option value="all_leads">All leads</option>
                <option value="contacted_leads">Contacted leads</option>
                <option value="all_bookings">All bookings customers</option>
                <option value="custom">Custom list (paste emails)</option>
              </select>
            </label>

            {/* Custom list */}
            {composer.audience === "custom" && (
              <label>
                Custom emails (one per line or comma-separated)
                <textarea
                  value={composer.customList}
                  onChange={(e) =>
                    setComposer((p) => ({ ...p, customList: e.target.value }))
                  }
                  placeholder="jane@example.com, john@example.com"
                  style={{ minHeight: 80, fontSize: 13 }}
                />
              </label>
            )}

            {/* Schedule */}
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 720,
                  color: "var(--muted)",
                  marginBottom: 8,
                }}
              >
                Send timing
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="ghost-button"
                  style={{
                    minHeight: 34,
                    padding: "0 14px",
                    fontSize: 13,
                    ...(composer.scheduleMode === "now"
                      ? { borderColor: "var(--blue)", color: "var(--blue)", background: "var(--soft-blue)" }
                      : {}),
                  }}
                  onClick={() => setComposer((p) => ({ ...p, scheduleMode: "now" }))}
                >
                  Send now
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  style={{
                    minHeight: 34,
                    padding: "0 14px",
                    fontSize: 13,
                    ...(composer.scheduleMode === "later"
                      ? { borderColor: "var(--blue)", color: "var(--blue)", background: "var(--soft-blue)" }
                      : {}),
                  }}
                  onClick={() => setComposer((p) => ({ ...p, scheduleMode: "later" }))}
                >
                  Schedule for later
                </button>
              </div>
              {composer.scheduleMode === "later" && (
                <input
                  type="datetime-local"
                  value={composer.scheduledAt}
                  onChange={(e) =>
                    setComposer((p) => ({ ...p, scheduledAt: e.target.value }))
                  }
                  style={{ marginTop: 8, maxWidth: 260 }}
                />
              )}
            </div>

            {/* Save error */}
            {saveError && (
              <p className="field-error" style={{ margin: 0 }}>
                {saveError}
              </p>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="primary-button"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Saving..." : editingId ? "Update campaign" : "Save as draft"}
              </button>
              {!editingId && composer.scheduleMode === "now" && (
                <span style={{ fontSize: 12, color: "var(--muted)", lineHeight: "38px" }}>
                  Save first, then send from the campaign list.
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Campaigns list */}
      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "var(--muted)",
            marginBottom: 10,
          }}
        >
          Campaigns
        </div>

        {loading && (
          <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading campaigns...</p>
        )}
        {error && (
          <p style={{ color: "#b42318", fontSize: 13 }}>
            {error}{" "}
            <button
              type="button"
              className="ghost-button"
              style={{ minHeight: 28, padding: "0 10px", fontSize: 12 }}
              onClick={fetchCampaigns}
            >
              Retry
            </button>
          </p>
        )}

        {!loading && !error && campaigns.length === 0 && (
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
            No campaigns yet. Use a quick template above or create one from scratch.
          </div>
        )}

        <div className="email-campaigns">
          {campaigns.map((c) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              onEdit={openEditComposer}
              onDuplicate={duplicateCampaign}
              onSend={(id) => {
                if (
                  typeof window !== "undefined" &&
                  !window.confirm(
                    `Send "${c.name}" now? This will email all selected recipients.`
                  )
                )
                  return;
                void handleSend(id);
              }}
            />
          ))}
        </div>

        {sendingId && (
          <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>
            Sending campaign...
          </p>
        )}
      </div>
    </section>
  );
}
