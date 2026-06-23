"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReviewRecord {
  id: string;
  tenantId: string;
  source: string;
  rating: number;
  text: string;
  authorName: string;
  authorPhoto?: string | null;
  response?: string | null;
  respondedAt?: string | null;
  externalId?: string | null;
  publishedAt?: string | null;
  featured: boolean;
  createdAt: string;
}

interface ReviewsData {
  reviews: ReviewRecord[];
  avgRating: number;
  totalCount: number;
  breakdown: Record<number, number>; // star → count
}

interface AddReviewForm {
  authorName: string;
  rating: number;
  text: string;
  source: string;
}

const EMPTY_FORM: AddReviewForm = {
  authorName: "",
  rating: 5,
  text: "",
  source: "manual",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stars(n: number): string {
  return "★".repeat(n) + "☆".repeat(5 - n);
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function SourceBadge({ source }: { source: string }) {
  const labels: Record<string, string> = {
    google: "Google",
    manual: "Manual",
  };
  const bg = source === "google" ? "#e8f0fe" : "#f3f6f8";
  const color = source === "google" ? "#1a73e8" : "#667085";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 6,
        background: bg,
        color,
        fontSize: 11,
        fontWeight: 750,
      }}
    >
      {labels[source] ?? source}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Review card
// ---------------------------------------------------------------------------

function ReviewCard({
  review,
  onReply,
  onToggleFeatured,
  onSuggestReply,
}: {
  review: ReviewRecord;
  onReply: (id: string, text: string) => Promise<void>;
  onToggleFeatured: (id: string, featured: boolean) => Promise<void>;
  onSuggestReply: (id: string) => Promise<void>;
}) {
  const [showReplyBox, setShowReplyBox] = useState(false);
  const [replyText, setReplyText] = useState(review.response ?? "");
  const [replySaving, setReplySaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [featureSaving, setFeatureSaving] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  async function handleSaveReply() {
    if (!replyText.trim()) return;
    setReplySaving(true);
    try {
      await onReply(review.id, replyText.trim());
      setShowReplyBox(false);
    } finally {
      setReplySaving(false);
    }
  }

  async function handleSuggest() {
    setSuggesting(true);
    try {
      await onSuggestReply(review.id);
    } finally {
      setSuggesting(false);
    }
  }

  async function handleToggleFeatured() {
    setFeatureSaving(true);
    try {
      await onToggleFeatured(review.id, !review.featured);
    } finally {
      setFeatureSaving(false);
    }
  }

  // When reply box opens, focus the textarea.
  useEffect(() => {
    if (showReplyBox) {
      textRef.current?.focus();
    }
  }, [showReplyBox]);

  return (
    <div className="review-card">
      <div className="review-header">
        <div className="review-author">
          <div className="review-avatar" aria-hidden="true">
            {initials(review.authorName)}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--heading)" }}>
              {review.authorName}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
              {fmtDate(review.publishedAt ?? review.createdAt)}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="reviews-stars" style={{ fontSize: 14 }}>
            {stars(review.rating)}
          </span>
          <SourceBadge source={review.source} />
        </div>
      </div>

      <p className="review-text">{review.text}</p>

      {/* Existing response */}
      {review.response && !showReplyBox && (
        <div className="review-response">
          <span style={{ fontWeight: 700, color: "var(--heading)", marginRight: 4 }}>
            Your reply:
          </span>
          {review.response}
          {review.respondedAt && (
            <span style={{ display: "block", marginTop: 4, fontSize: 11 }}>
              {fmtDate(review.respondedAt)}
            </span>
          )}
        </div>
      )}

      {/* Action row */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
        <button
          type="button"
          className="ghost-button"
          style={{ minHeight: 30, padding: "0 10px", fontSize: 12 }}
          onClick={() => setShowReplyBox((v) => !v)}
        >
          {showReplyBox ? "Cancel" : review.response ? "Edit reply" : "Reply"}
        </button>

        <button
          type="button"
          className="ghost-button"
          style={{
            minHeight: 30,
            padding: "0 10px",
            fontSize: 12,
            ...(review.featured
              ? { borderColor: "var(--green)", color: "var(--green)", background: "#e7f5ec" }
              : {}),
          }}
          onClick={handleToggleFeatured}
          disabled={featureSaving}
          aria-pressed={review.featured}
        >
          {featureSaving ? "..." : review.featured ? "Featured on site" : "Feature on site"}
        </button>
      </div>

      {/* Reply box */}
      {showReplyBox && (
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          <textarea
            ref={textRef}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Write your response..."
            rows={3}
            style={{ fontSize: 13 }}
          />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              className="primary-button"
              style={{ minHeight: 32, padding: "0 13px", fontSize: 12 }}
              onClick={handleSaveReply}
              disabled={replySaving || !replyText.trim()}
            >
              {replySaving ? "Saving..." : "Save reply"}
            </button>
            <button
              type="button"
              className="ghost-button"
              style={{ minHeight: 32, padding: "0 11px", fontSize: 12 }}
              onClick={handleSuggest}
              disabled={suggesting}
            >
              {suggesting ? "Generating..." : "Suggest reply (AI)"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ReviewsDashboard() {
  const [data, setData] = useState<ReviewsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add review form
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<AddReviewForm>(EMPTY_FORM);
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState("");

  // Request review state
  const [gbpUrl, setGbpUrl] = useState("");
  const [waLink, setWaLink] = useState<string | null>(null);

  // AI suggestion state: reviewId → suggested text
  const [suggestions, setSuggestions] = useState<Record<string, string>>({});

  // ---------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/reviews");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ReviewsData;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load reviews");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchReviews();
  }, [fetchReviews]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  async function handleReply(id: string, text: string) {
    const res = await fetch("/api/dashboard/reviews", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, response: text }),
    });
    if (!res.ok) throw new Error("Failed to save reply");
    const { review } = (await res.json()) as { review: ReviewRecord };
    setData((prev) =>
      prev
        ? {
            ...prev,
            reviews: prev.reviews.map((r) => (r.id === id ? review : r)),
          }
        : prev,
    );
  }

  async function handleToggleFeatured(id: string, featured: boolean) {
    const res = await fetch("/api/dashboard/reviews", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, featured }),
    });
    if (!res.ok) throw new Error("Failed to update featured status");
    const { review } = (await res.json()) as { review: ReviewRecord };
    setData((prev) =>
      prev
        ? {
            ...prev,
            reviews: prev.reviews.map((r) => (r.id === id ? review : r)),
          }
        : prev,
    );
  }

  async function handleSuggestReply(id: string) {
    const review = data?.reviews.find((r) => r.id === id);
    if (!review) return;

    const res = await fetch("/api/reviews/suggest-reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reviewText: review.text,
        rating: review.rating,
        businessName: "",     // populated from tenant profile on the server
        industry: "",
      }),
    });
    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      if (body.error === "insufficient_credits") {
        alert("Insufficient AI credits. Top up in the Credits section.");
      }
      return;
    }
    const { response } = (await res.json()) as { response: string };
    setSuggestions((prev) => ({ ...prev, [id]: response }));

    // Inject the suggestion into the review's reply box by updating text state.
    // We surface it as a suggestion that pre-fills the textarea — the user still
    // saves manually.
    setData((prev) =>
      prev
        ? {
            ...prev,
            reviews: prev.reviews.map((r) =>
              r.id === id ? { ...r, response: response } : r,
            ),
          }
        : prev,
    );
  }

  async function handleAddReview(e: React.FormEvent) {
    e.preventDefault();
    setAddError("");
    if (!addForm.authorName.trim()) {
      setAddError("Author name is required.");
      return;
    }
    if (!addForm.text.trim()) {
      setAddError("Review text is required.");
      return;
    }
    setAddSaving(true);
    try {
      const res = await fetch("/api/dashboard/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Failed to create review");
      }
      setAddForm(EMPTY_FORM);
      setShowAddForm(false);
      void fetchReviews();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Error");
    } finally {
      setAddSaving(false);
    }
  }

  function handleGenerateWaLink() {
    if (!gbpUrl.trim()) return;
    const msg = encodeURIComponent(
      `We'd love your feedback! Leave us a Google review: ${gbpUrl.trim()}`,
    );
    setWaLink(`https://wa.me/?text=${msg}`);
  }

  // ---------------------------------------------------------------------------
  // Overview section
  // ---------------------------------------------------------------------------

  function ReviewsOverview({ d }: { d: ReviewsData }) {
    const maxCount = Math.max(1, ...Object.values(d.breakdown));
    return (
      <div className="reviews-overview">
        <div className="reviews-avg">
          <div className="reviews-avg-num">{d.avgRating.toFixed(1)}</div>
          <div className="reviews-stars">{stars(Math.round(d.avgRating))}</div>
          <div className="reviews-count">
            {d.totalCount} {d.totalCount === 1 ? "review" : "reviews"}
          </div>
        </div>
        <div className="reviews-breakdown">
          {[5, 4, 3, 2, 1].map((star) => {
            const count = d.breakdown[star] ?? 0;
            const pct = Math.round((count / maxCount) * 100);
            return (
              <div key={star} className="review-bar-row">
                <span style={{ minWidth: 16, textAlign: "right" }}>{star}</span>
                <span className="reviews-stars" style={{ fontSize: 12 }}>★</span>
                <div className="review-bar-track">
                  <div className="review-bar-fill" style={{ width: `${pct}%` }} />
                </div>
                <span style={{ minWidth: 22, color: "var(--muted)" }}>{count}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <section style={{ padding: "0 0 32px" }}>

      {/* Error / loading */}
      {error && (
        <p style={{ color: "#b42318", fontSize: 13, margin: "0 0 12px" }}>
          {error}{" "}
          <button
            type="button"
            className="ghost-button"
            style={{ minHeight: 28, padding: "0 10px", fontSize: 12 }}
            onClick={fetchReviews}
          >
            Retry
          </button>
        </p>
      )}
      {loading && (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading reviews...</p>
      )}

      {data && (
        <>
          {/* Overview */}
          {data.totalCount > 0 && <ReviewsOverview d={data} />}

          {data.totalCount === 0 && !showAddForm && (
            <div
              style={{
                padding: "24px",
                borderRadius: 10,
                border: "1px dashed var(--border)",
                color: "var(--muted)",
                fontSize: 13,
                textAlign: "center",
                marginBottom: 16,
              }}
            >
              No reviews yet. Add one manually or generate a request link below.
            </div>
          )}

          {/* Toolbar */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
            <button
              type="button"
              className="primary-button"
              style={{ minHeight: 34, padding: "0 14px", fontSize: 12 }}
              onClick={() => setShowAddForm((v) => !v)}
            >
              {showAddForm ? "Cancel" : "+ Add review"}
            </button>
          </div>

          {/* Add review form */}
          {showAddForm && (
            <form
              onSubmit={handleAddReview}
              style={{
                display: "grid",
                gap: 12,
                marginBottom: 16,
                padding: "16px",
                border: "1px solid var(--border)",
                borderRadius: 10,
                background: "#fff",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                }}
              >
                <label>
                  Author name *
                  <input
                    type="text"
                    value={addForm.authorName}
                    onChange={(e) =>
                      setAddForm((f) => ({ ...f, authorName: e.target.value }))
                    }
                    placeholder="Jane Dlamini"
                    required
                    style={{ fontSize: 13 }}
                  />
                </label>
                <label>
                  Source
                  <select
                    className="crm-stage-select"
                    value={addForm.source}
                    onChange={(e) =>
                      setAddForm((f) => ({ ...f, source: e.target.value }))
                    }
                    style={{ height: 38, fontSize: 13 }}
                  >
                    <option value="manual">Manual</option>
                    <option value="google">Google</option>
                  </select>
                </label>
              </div>
              <label>
                Star rating
                <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setAddForm((f) => ({ ...f, rating: n }))}
                      style={{
                        minHeight: 34,
                        minWidth: 34,
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        background: addForm.rating >= n ? "#fff9e6" : "#fff",
                        color: addForm.rating >= n ? "#f59e0b" : "var(--muted)",
                        fontSize: 18,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                      aria-pressed={addForm.rating === n}
                      aria-label={`${n} star`}
                    >
                      ★
                    </button>
                  ))}
                  <span style={{ alignSelf: "center", marginLeft: 6, fontSize: 13, color: "var(--muted)" }}>
                    {addForm.rating} / 5
                  </span>
                </div>
              </label>
              <label>
                Review text *
                <textarea
                  value={addForm.text}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, text: e.target.value }))
                  }
                  placeholder="What did the customer say?"
                  rows={3}
                  required
                  style={{ fontSize: 13 }}
                />
              </label>
              {addError && (
                <p className="field-error" style={{ margin: 0 }}>
                  {addError}
                </p>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="submit"
                  className="primary-button"
                  style={{ minHeight: 34, padding: "0 16px", fontSize: 12 }}
                  disabled={addSaving}
                >
                  {addSaving ? "Saving..." : "Add review"}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  style={{ minHeight: 34, padding: "0 12px", fontSize: 12 }}
                  onClick={() => {
                    setShowAddForm(false);
                    setAddError("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {/* Request review section */}
          <div
            style={{
              padding: "14px 16px",
              border: "1px solid var(--border)",
              borderRadius: 10,
              background: "#f8fafc",
              marginBottom: 20,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13, color: "var(--heading)", marginBottom: 8 }}>
              Request a Google review via WhatsApp
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={{ flex: "1 1 260px" }}>
                Google Business Profile URL
                <input
                  type="url"
                  value={gbpUrl}
                  onChange={(e) => {
                    setGbpUrl(e.target.value);
                    setWaLink(null);
                  }}
                  placeholder="https://g.page/r/..."
                  style={{ fontSize: 13 }}
                />
              </label>
              <button
                type="button"
                className="ghost-button"
                style={{ minHeight: 38, padding: "0 13px", fontSize: 12 }}
                onClick={handleGenerateWaLink}
                disabled={!gbpUrl.trim()}
              >
                Generate link
              </button>
            </div>
            {waLink && (
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <a
                  href={waLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="primary-button"
                  style={{
                    minHeight: 34,
                    padding: "0 13px",
                    fontSize: 12,
                    textDecoration: "none",
                    background: "#25d366",
                  }}
                >
                  Open WhatsApp link
                </a>
                <button
                  type="button"
                  className="ghost-button"
                  style={{ minHeight: 34, padding: "0 11px", fontSize: 12 }}
                  onClick={() => {
                    void navigator.clipboard.writeText(waLink);
                  }}
                >
                  Copy link
                </button>
              </div>
            )}
          </div>

          {/* Review list */}
          {data.reviews.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  color: "var(--muted)",
                  letterSpacing: "0.04em",
                  marginBottom: 10,
                }}
              >
                All reviews ({data.totalCount})
              </div>
              {data.reviews.map((review) => (
                <ReviewCard
                  key={review.id}
                  review={
                    suggestions[review.id]
                      ? { ...review, response: suggestions[review.id] }
                      : review
                  }
                  onReply={handleReply}
                  onToggleFeatured={handleToggleFeatured}
                  onSuggestReply={handleSuggestReply}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
