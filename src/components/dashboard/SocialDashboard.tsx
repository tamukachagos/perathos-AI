"use client";

import { useEffect, useState, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Platform = "facebook" | "instagram" | "tiktok" | "linkedin" | "twitter";
type Tone = "professional" | "casual" | "promotional";
type PostStatus = "draft" | "scheduled" | "posted" | "failed" | "canceled";
type ScheduleMode = "now" | "later";

interface SocialPost {
  id: string;
  content: string;
  platforms: string[];
  scheduledAt: string | null;
  postedAt: string | null;
  status: PostStatus;
  imageUrl?: string | null;
  error?: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLATFORMS: { id: Platform; label: string; color: string }[] = [
  { id: "facebook", label: "Facebook", color: "#1877F2" },
  { id: "instagram", label: "Instagram", color: "#E1306C" },
  { id: "tiktok", label: "TikTok", color: "#010101" },
  { id: "linkedin", label: "LinkedIn", color: "#0A66C2" },
  { id: "twitter", label: "X (Twitter)", color: "#000000" },
];

const PLATFORM_COLORS: Record<string, string> = {
  facebook: "#1877F2",
  instagram: "#E1306C",
  tiktok: "#010101",
  linkedin: "#0A66C2",
  twitter: "#000000",
};

const STATUS_CLASS: Record<PostStatus, string> = {
  draft: "status-pending",
  scheduled: "status-review",
  posted: "status-ready",
  failed: "",
  canceled: "",
};

const STATUS_LABEL: Record<PostStatus, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  posted: "Posted",
  failed: "Failed",
  canceled: "Canceled",
};

const MAX_CHARS = 2200;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function localDatetimeMin(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 5);
  return d.toISOString().slice(0, 16);
}

// ---------------------------------------------------------------------------
// Platform dot indicator
// ---------------------------------------------------------------------------

function PlatformDots({ platforms }: { platforms: string[] }) {
  return (
    <div className="social-post-platforms">
      {platforms.map((p) => (
        <div
          key={p}
          className="social-platform-dot"
          title={p.charAt(0).toUpperCase() + p.slice(1)}
          style={{ background: PLATFORM_COLORS[p] ?? "var(--accent, #1877F2)" }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Platform preview card
// ---------------------------------------------------------------------------

function PostPreview({
  content,
  imageUrl,
  platforms,
}: {
  content: string;
  imageUrl: string;
  platforms: Platform[];
}) {
  if (!content.trim() && platforms.length === 0) return null;

  const firstPlatform = platforms[0];
  const platformLabel = firstPlatform
    ? PLATFORMS.find((p) => p.id === firstPlatform)?.label ?? firstPlatform
    : "Social";
  const platformColor = firstPlatform
    ? PLATFORM_COLORS[firstPlatform] ?? "var(--blue)"
    : "var(--blue)";

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 16,
        background: "#f8fafc",
        marginBottom: 12,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: platformColor,
          marginBottom: 8,
        }}
      >
        {platformLabel} Preview
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #0f5132, #123a6f)",
            display: "grid",
            placeItems: "center",
            color: "#ffffff",
            fontSize: 12,
            fontWeight: 800,
          }}
        >
          LD
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--heading)" }}>
            Your Business
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)" }}>Just now</div>
        </div>
      </div>
      {imageUrl && (
        <div
          style={{
            borderRadius: 8,
            overflow: "hidden",
            marginBottom: 8,
            background: "var(--border)",
            height: 120,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            color: "var(--muted)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt="Post image"
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "cover" }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      )}
      <p
        style={{
          margin: 0,
          fontSize: 13,
          lineHeight: 1.5,
          color: "var(--text)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {content || <em style={{ color: "var(--muted)" }}>Your post content will appear here...</em>}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compose panel
// ---------------------------------------------------------------------------

interface ComposePanelProps {
  onPostCreated: () => void;
  businessName?: string;
  industry?: string;
}

function ComposePanel({ onPostCreated, businessName = "My Business", industry = "business" }: ComposePanelProps) {
  const [content, setContent] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<Platform>>(new Set(["facebook"]));
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("now");
  const [scheduledAt, setScheduledAt] = useState(localDatetimeMin());
  const [tone, setTone] = useState<Tone>("professional");
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function togglePlatform(p: Platform) {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const platformArr = Array.from(selectedPlatforms);
      const res = await fetch("/api/social/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName,
          industry,
          topic: content.trim() || undefined,
          tone,
          platform: platformArr[0] ?? "facebook",
        }),
      });
      const json = (await res.json()) as { ok: boolean; caption?: string; hashtags?: string[]; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Generation failed");
      const hashtags = (json.hashtags ?? []).join(" ");
      const full = hashtags ? `${json.caption ?? ""}\n\n${hashtags}` : (json.caption ?? "");
      setContent(full);
      textareaRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate caption");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSubmit() {
    if (!content.trim()) { setError("Post content is required"); return; }
    if (selectedPlatforms.size === 0) { setError("Select at least one platform"); return; }
    setSubmitting(true);
    setError(null);
    setStatus(null);
    try {
      const body: Record<string, unknown> = {
        content: content.trim(),
        platforms: Array.from(selectedPlatforms),
        imageUrl: imageUrl.trim() || undefined,
      };
      if (scheduleMode === "later") {
        body.scheduledAt = new Date(scheduledAt).toISOString();
      }
      const res = await fetch("/api/social/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Failed to post");
      setStatus(scheduleMode === "now" ? "Posted successfully!" : "Post scheduled!");
      setContent("");
      setImageUrl("");
      onPostCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit post");
    } finally {
      setSubmitting(false);
    }
  }

  const charsLeft = MAX_CHARS - content.length;
  const platformArr = Array.from(selectedPlatforms);

  return (
    <div className="social-compose">
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 750, color: "var(--heading)", marginBottom: 4 }}>
          Compose Post
        </div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>
          Write or generate content and publish to multiple platforms at once.
        </div>
      </div>

      {/* Platform selector */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 720, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
          Platforms
        </div>
        <div className="social-platforms">
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => togglePlatform(p.id)}
              className={`social-platform-check${selectedPlatforms.has(p.id) ? " active" : ""}`}
              style={selectedPlatforms.has(p.id) ? { background: p.color, borderColor: p.color } : {}}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tone selector */}
      <div style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 720, color: "var(--muted)", marginRight: 4 }}>Tone:</span>
        {(["professional", "casual", "promotional"] as Tone[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTone(t)}
            className={tone === t ? "primary-button" : "ghost-button"}
            style={{ minHeight: 28, padding: "0 10px", fontSize: 11 }}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="ghost-button"
          style={{ marginLeft: "auto", minHeight: 28, padding: "0 12px", fontSize: 12, fontWeight: 700 }}
        >
          {generating ? "Generating…" : "Generate caption"}
        </button>
      </div>

      {/* Preview */}
      <PostPreview
        content={content}
        imageUrl={imageUrl}
        platforms={platformArr as Platform[]}
      />

      {/* Textarea */}
      <div style={{ position: "relative", marginBottom: 12 }}>
        <textarea
          ref={textareaRef}
          className="social-compose-area"
          placeholder="What's on your mind? Write your post here or use 'Generate caption'…"
          value={content}
          onChange={(e) => setContent(e.target.value.slice(0, MAX_CHARS))}
          rows={4}
          style={{ marginBottom: 0 }}
        />
        <div
          style={{
            textAlign: "right",
            fontSize: 11,
            color: charsLeft < 100 ? "#b42318" : "var(--muted)",
            marginTop: 4,
          }}
        >
          {charsLeft} chars remaining
        </div>
      </div>

      {/* Image URL */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 720, color: "var(--muted)", marginBottom: 6 }}>
          Image URL (optional)
        </label>
        <input
          type="url"
          placeholder="https://example.com/image.jpg"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
        />
      </div>

      {/* Schedule */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 720, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
          When to post
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: scheduleMode === "later" ? 10 : 0, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setScheduleMode("now")}
            className={scheduleMode === "now" ? "primary-button" : "ghost-button"}
            style={{ minHeight: 32, padding: "0 14px", fontSize: 12 }}
          >
            Post now
          </button>
          <button
            type="button"
            onClick={() => setScheduleMode("later")}
            className={scheduleMode === "later" ? "primary-button" : "ghost-button"}
            style={{ minHeight: 32, padding: "0 14px", fontSize: 12 }}
          >
            Schedule for later
          </button>
        </div>
        {scheduleMode === "later" && (
          <input
            type="datetime-local"
            value={scheduledAt}
            min={localDatetimeMin()}
            onChange={(e) => setScheduledAt(e.target.value)}
            style={{ marginTop: 8, maxWidth: 280 }}
          />
        )}
      </div>

      {/* Feedback */}
      {status && (
        <p className="sr-status" style={{ marginBottom: 8 }}>{status}</p>
      )}
      {error && (
        <p className="field-error" style={{ marginBottom: 8 }}>{error}</p>
      )}

      {/* Submit */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting || !content.trim() || selectedPlatforms.size === 0}
        className="primary-button"
        style={{ width: "100%", justifyContent: "center" }}
      >
        {submitting
          ? "Submitting…"
          : scheduleMode === "now"
          ? "Post Now"
          : "Schedule Post"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scheduled posts list
// ---------------------------------------------------------------------------

function ScheduledPostsList({
  posts,
  onAction,
}: {
  posts: SocialPost[];
  onAction: () => void;
}) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCancel(id: string) {
    setActionLoading(id);
    setError(null);
    try {
      const res = await fetch(`/api/social/posts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Cancel failed");
      onAction();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setActionLoading(null);
    }
  }

  async function handlePostNow(post: SocialPost) {
    setActionLoading(post.id);
    setError(null);
    try {
      const res = await fetch("/api/social/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: post.content,
          platforms: post.platforms,
          imageUrl: post.imageUrl,
          cancelId: post.id,
        }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Failed to post");
      onAction();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Post now failed");
    } finally {
      setActionLoading(null);
    }
  }

  if (posts.length === 0) {
    return (
      <div style={{ padding: "24px 0", color: "var(--muted)", fontSize: 13 }}>
        No scheduled posts. Compose one above.
      </div>
    );
  }

  return (
    <>
      {error && <p className="field-error" style={{ marginBottom: 8 }}>{error}</p>}
      {posts.map((post) => (
        <div key={post.id} className="social-post-row">
          <div className="social-post-preview" title={post.content}>
            {post.content.slice(0, 60)}{post.content.length > 60 ? "…" : ""}
          </div>
          <PlatformDots platforms={post.platforms} />
          <div style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
            {fmtDate(post.scheduledAt)}
          </div>
          <span className={`status-dot ${STATUS_CLASS[post.status] ?? "status-pending"}`}>
            {STATUS_LABEL[post.status] ?? post.status}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              className="ghost-button"
              style={{ minHeight: 28, padding: "0 10px", fontSize: 11 }}
              disabled={actionLoading === post.id}
              onClick={() => handlePostNow(post)}
            >
              Post Now
            </button>
            <button
              type="button"
              className="ghost-button"
              style={{ minHeight: 28, padding: "0 10px", fontSize: 11, color: "#b42318" }}
              disabled={actionLoading === post.id}
              onClick={() => handleCancel(post.id)}
            >
              {actionLoading === post.id ? "…" : "Cancel"}
            </button>
          </div>
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Past posts list
// ---------------------------------------------------------------------------

function PastPostsList({ posts }: { posts: SocialPost[] }) {
  if (posts.length === 0) {
    return (
      <div style={{ padding: "24px 0", color: "var(--muted)", fontSize: 13 }}>
        No past posts yet.
      </div>
    );
  }

  return (
    <>
      {posts.map((post) => (
        <div key={post.id} className="social-post-row">
          <div className="social-post-preview" title={post.content}>
            {post.content.slice(0, 80)}{post.content.length > 80 ? "…" : ""}
          </div>
          <PlatformDots platforms={post.platforms} />
          <div style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
            {fmtDate(post.postedAt ?? post.createdAt)}
          </div>
          <span className={`status-dot ${STATUS_CLASS[post.status] ?? "status-pending"}`}>
            {STATUS_LABEL[post.status] ?? post.status}
          </span>
          {post.error && (
            <span style={{ fontSize: 11, color: "#b42318" }} title={post.error}>
              Error
            </span>
          )}
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main SocialDashboard
// ---------------------------------------------------------------------------

export function SocialDashboard({
  businessName,
  industry,
}: {
  businessName?: string;
  industry?: string;
}) {
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  async function loadPosts() {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/social/posts");
      const json = (await res.json()) as { ok: boolean; posts?: SocialPost[]; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Failed to load posts");
      setPosts(json.posts ?? []);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load posts");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPosts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scheduled = posts.filter((p) => p.status === "scheduled");
  const past = posts.filter((p) => p.status === "posted" || p.status === "failed" || p.status === "canceled");

  return (
    <section>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, gap: 16 }}>
        <div>
          <h2 style={{ margin: "0 0 4px", fontSize: 22, color: "var(--heading)" }}>
            Social Media
          </h2>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
            Schedule and manage posts across Facebook, Instagram, TikTok, LinkedIn, and X.
          </p>
        </div>
        <button
          type="button"
          className="ghost-button"
          style={{ fontSize: 12, minHeight: 32, padding: "0 12px", flexShrink: 0 }}
          onClick={() => { void loadPosts(); }}
        >
          Refresh
        </button>
      </div>

      {/* Compose */}
      <ComposePanel
        onPostCreated={() => { void loadPosts(); }}
        businessName={businessName}
        industry={industry}
      />

      {/* Scheduled posts */}
      <div
        style={{
          background: "#ffffff",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 20,
          marginBottom: 20,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 750, color: "var(--heading)", marginBottom: 14 }}>
          Scheduled Posts{scheduled.length > 0 ? ` (${scheduled.length})` : ""}
        </div>
        {loading ? (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</div>
        ) : fetchError ? (
          <div style={{ color: "#b42318", fontSize: 13 }}>{fetchError}</div>
        ) : (
          <ScheduledPostsList posts={scheduled} onAction={() => { void loadPosts(); }} />
        )}
      </div>

      {/* Past posts */}
      <div
        style={{
          background: "#ffffff",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 20,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 750, color: "var(--heading)", marginBottom: 14 }}>
          Past Posts{past.length > 0 ? ` (${past.length})` : ""}
        </div>
        {loading ? (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</div>
        ) : (
          <PastPostsList posts={past} />
        )}
      </div>
    </section>
  );
}
