"use client";

// Pages management dashboard. Lets the tenant list, create, edit, publish, and
// delete SitePages. Includes a block editor with AI generation support.
//
// Block types supported:
//   heading | paragraph | image | cta | services | gallery | divider

import { useCallback, useEffect, useReducer, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Block types
// ---------------------------------------------------------------------------

interface HeadingBlock { type: "heading"; text: string; level: 1 | 2 | 3 }
interface ParagraphBlock { type: "paragraph"; text: string }
interface ImageBlock { type: "image"; url: string; alt: string; caption?: string }
interface CtaBlock { type: "cta"; heading: string; subtext: string; buttonText: string; buttonHref: string }
interface ServiceItem { name: string; description: string; price?: string }
interface ServicesBlock { type: "services"; items: ServiceItem[] }
interface GalleryImage { url: string; alt: string }
interface GalleryBlock { type: "gallery"; images: GalleryImage[] }
interface DividerBlock { type: "divider" }

type Block =
  | HeadingBlock
  | ParagraphBlock
  | ImageBlock
  | CtaBlock
  | ServicesBlock
  | GalleryBlock
  | DividerBlock;

// ---------------------------------------------------------------------------
// Page record
// ---------------------------------------------------------------------------

interface SitePageRecord {
  id: string;
  siteSlug: string;
  path: string;
  title: string;
  metaDesc?: string | null;
  blocks: Block[];
  published: boolean;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// State / reducer for the pages list
// ---------------------------------------------------------------------------

type PagesState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; pages: SitePageRecord[] }
  | { status: "error"; message: string };

type PagesAction =
  | { type: "fetch" }
  | { type: "loaded"; pages: SitePageRecord[] }
  | { type: "error"; message: string }
  | { type: "upsert"; page: SitePageRecord }
  | { type: "remove"; id: string };

function pagesReducer(state: PagesState, action: PagesAction): PagesState {
  switch (action.type) {
    case "fetch":
      return { status: "loading" };
    case "loaded":
      return { status: "loaded", pages: action.pages };
    case "error":
      return { status: "error", message: action.message };
    case "upsert": {
      if (state.status !== "loaded") return state;
      const existing = state.pages.find((p) => p.id === action.page.id);
      const pages = existing
        ? state.pages.map((p) => (p.id === action.page.id ? action.page : p))
        : [...state.pages, action.page];
      return { status: "loaded", pages };
    }
    case "remove": {
      if (state.status !== "loaded") return state;
      return { status: "loaded", pages: state.pages.filter((p) => p.id !== action.id) };
    }
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Block editor helpers
// ---------------------------------------------------------------------------

function defaultForType(type: Block["type"]): Block {
  switch (type) {
    case "heading": return { type: "heading", text: "", level: 2 };
    case "paragraph": return { type: "paragraph", text: "" };
    case "image": return { type: "image", url: "", alt: "" };
    case "cta": return { type: "cta", heading: "", subtext: "", buttonText: "Learn more", buttonHref: "#contact" };
    case "services": return { type: "services", items: [{ name: "", description: "" }] };
    case "gallery": return { type: "gallery", images: [{ url: "", alt: "" }] };
    case "divider": return { type: "divider" };
  }
}

function blockLabel(block: Block): string {
  switch (block.type) {
    case "heading": return `H${block.level}: ${block.text || "(empty)"}`;
    case "paragraph": return `¶ ${block.text.slice(0, 50) || "(empty)"}`;
    case "image": return `Image: ${block.alt || block.url || "(no alt)"}`;
    case "cta": return `CTA: ${block.heading || "(empty)"}`;
    case "services": return `Services (${block.items.length} items)`;
    case "gallery": return `Gallery (${block.images.length} images)`;
    case "divider": return "Divider";
  }
}

// ---------------------------------------------------------------------------
// Block editor sub-components
// ---------------------------------------------------------------------------

interface BlockEditorProps {
  block: Block;
  onChange: (updated: Block) => void;
}

function BlockEditor({ block, onChange }: BlockEditorProps) {
  switch (block.type) {
    case "heading":
      return (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
            <input
              value={block.text}
              onChange={(e) => onChange({ ...block, text: e.target.value })}
              placeholder="Heading text"
            />
            <select
              value={block.level}
              onChange={(e) => onChange({ ...block, level: Number(e.target.value) as 1 | 2 | 3 })}
              style={{ height: 38, border: "1px solid var(--border)", borderRadius: 7, padding: "0 8px", fontFamily: "inherit" }}
            >
              <option value={1}>H1</option>
              <option value={2}>H2</option>
              <option value={3}>H3</option>
            </select>
          </div>
        </div>
      );

    case "paragraph":
      return (
        <textarea
          value={block.text}
          onChange={(e) => onChange({ ...block, text: e.target.value })}
          placeholder="Paragraph text"
          style={{ minHeight: 80 }}
        />
      );

    case "image":
      return (
        <div style={{ display: "grid", gap: 8 }}>
          <input
            value={block.url}
            onChange={(e) => onChange({ ...block, url: e.target.value })}
            placeholder="Image URL"
          />
          <input
            value={block.alt}
            onChange={(e) => onChange({ ...block, alt: e.target.value })}
            placeholder="Alt text (accessibility)"
          />
          <input
            value={block.caption ?? ""}
            onChange={(e) => onChange({ ...block, caption: e.target.value || undefined })}
            placeholder="Caption (optional)"
          />
        </div>
      );

    case "cta":
      return (
        <div style={{ display: "grid", gap: 8 }}>
          <input
            value={block.heading}
            onChange={(e) => onChange({ ...block, heading: e.target.value })}
            placeholder="CTA heading"
          />
          <input
            value={block.subtext}
            onChange={(e) => onChange({ ...block, subtext: e.target.value })}
            placeholder="Subtext"
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <input
              value={block.buttonText}
              onChange={(e) => onChange({ ...block, buttonText: e.target.value })}
              placeholder="Button label"
            />
            <input
              value={block.buttonHref}
              onChange={(e) => onChange({ ...block, buttonHref: e.target.value })}
              placeholder="Button href"
            />
          </div>
        </div>
      );

    case "services":
      return (
        <div style={{ display: "grid", gap: 8 }}>
          {block.items.map((item, i) => (
            <div
              key={i}
              style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 6, alignItems: "center" }}
            >
              <input
                value={item.name}
                onChange={(e) => {
                  const items = block.items.map((it, j) =>
                    j === i ? { ...it, name: e.target.value } : it
                  );
                  onChange({ ...block, items });
                }}
                placeholder="Service name"
              />
              <input
                value={item.description}
                onChange={(e) => {
                  const items = block.items.map((it, j) =>
                    j === i ? { ...it, description: e.target.value } : it
                  );
                  onChange({ ...block, items });
                }}
                placeholder="Description"
              />
              <input
                value={item.price ?? ""}
                onChange={(e) => {
                  const items = block.items.map((it, j) =>
                    j === i ? { ...it, price: e.target.value || undefined } : it
                  );
                  onChange({ ...block, items });
                }}
                placeholder="Price"
                style={{ width: 100 }}
              />
            </div>
          ))}
          <button
            type="button"
            className="add-block-btn"
            onClick={() =>
              onChange({ ...block, items: [...block.items, { name: "", description: "" }] })
            }
          >
            + Add item
          </button>
        </div>
      );

    case "gallery":
      return (
        <div style={{ display: "grid", gap: 8 }}>
          {block.images.map((img, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <input
                value={img.url}
                onChange={(e) => {
                  const images = block.images.map((im, j) =>
                    j === i ? { ...im, url: e.target.value } : im
                  );
                  onChange({ ...block, images });
                }}
                placeholder="Image URL"
              />
              <input
                value={img.alt}
                onChange={(e) => {
                  const images = block.images.map((im, j) =>
                    j === i ? { ...im, alt: e.target.value } : im
                  );
                  onChange({ ...block, images });
                }}
                placeholder="Alt text"
              />
            </div>
          ))}
          <button
            type="button"
            className="add-block-btn"
            onClick={() =>
              onChange({ ...block, images: [...block.images, { url: "", alt: "" }] })
            }
          >
            + Add image
          </button>
        </div>
      );

    case "divider":
      return (
        <div
          style={{
            height: 1,
            background: "var(--border)",
            margin: "4px 0",
            borderRadius: 1,
          }}
        />
      );

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Page editor modal
// ---------------------------------------------------------------------------

interface PageEditorProps {
  page: Partial<SitePageRecord> | null; // null = new page
  businessName: string;
  industry: string;
  onClose: () => void;
  onSaved: (page: SitePageRecord) => void;
  onNotice: (msg: string) => void;
}

type PageType = "about" | "blog-post" | "menu" | "pricing" | "contact";

function PageEditor({ page, businessName, industry, onClose, onSaved, onNotice }: PageEditorProps) {
  const isNew = !page?.id;
  const [title, setTitle] = useState(page?.title ?? "");
  const [path, setPath] = useState(page?.path ?? "");
  const [metaDesc, setMetaDesc] = useState(page?.metaDesc ?? "");
  const [blocks, setBlocks] = useState<Block[]>(page?.blocks ?? []);
  const [published, setPublished] = useState(page?.published ?? false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genType, setGenType] = useState<PageType>("about");
  const [genTopic, setGenTopic] = useState("");
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // Auto-generate path from title when creating new page.
  useEffect(() => {
    if (isNew && title && !path) {
      const slug = title
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 80);
      setPath(`/${slug}`);
    }
  }, [title, isNew, path]);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  function addBlock(type: Block["type"]) {
    setBlocks((prev) => [...prev, defaultForType(type)]);
  }

  function updateBlock(index: number, updated: Block) {
    setBlocks((prev) => prev.map((b, i) => (i === index ? updated : b)));
  }

  function removeBlock(index: number) {
    setBlocks((prev) => prev.filter((_, i) => i !== index));
  }

  function moveBlock(index: number, dir: -1 | 1) {
    setBlocks((prev) => {
      const arr = [...prev];
      const target = index + dir;
      if (target < 0 || target >= arr.length) return prev;
      [arr[index], arr[target]] = [arr[target], arr[index]];
      return arr;
    });
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/pages/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageType: genType,
          businessName: businessName || "My Business",
          industry: industry || "business",
          topic: genTopic || undefined,
        }),
      });
      const data = (await res.json()) as { ok: boolean; blocks?: Block[]; error?: string };
      if (data.ok && Array.isArray(data.blocks)) {
        setBlocks(data.blocks);
        if (!title) {
          const typeLabels: Record<PageType, string> = {
            about: "About Us",
            "blog-post": genTopic || "Blog Post",
            menu: "Our Services",
            pricing: "Pricing",
            contact: "Contact",
          };
          setTitle(typeLabels[genType]);
        }
        onNotice("AI generated page content — review and edit before saving.");
      } else {
        setError(data.error === "insufficient_credits" ? "Not enough AI credits." : "Generation failed. Try again.");
      }
    } catch {
      setError("Could not reach the generate endpoint.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const method = isNew ? "POST" : "PATCH";
      const body: Record<string, unknown> = { title, path, metaDesc, blocks, published };
      if (!isNew) body.id = page?.id;

      const res = await fetch("/api/dashboard/pages", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok: boolean; page?: SitePageRecord; error?: string };
      if (data.ok && data.page) {
        onSaved(data.page);
        onNotice(isNew ? "Page created." : "Page saved.");
      } else {
        const msgs: Record<string, string> = {
          path_conflict: "That URL path is already taken. Choose a different path.",
          title_required: "Title is required.",
          no_site_found: "Publish your main site before adding pages.",
        };
        setError(msgs[data.error ?? ""] ?? "Save failed. Try again.");
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  const BLOCK_TYPES: Block["type"][] = [
    "heading",
    "paragraph",
    "image",
    "cta",
    "services",
    "gallery",
    "divider",
  ];

  return (
    <div className="wizard-overlay" role="dialog" aria-modal="true" aria-label="Page editor">
      <div
        className="wizard-panel panel"
        style={{ width: "min(800px, 100%)", padding: 24 }}
      >
        <h2 style={{ margin: "0 0 16px", fontSize: 20, color: "var(--heading)" }}>
          {isNew ? "New page" : `Edit: ${page?.title}`}
        </h2>

        {/* Title + path */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <label>
            Title
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. About Us"
            />
          </label>
          <label>
            URL path
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/about"
            />
          </label>
        </div>

        <label style={{ marginBottom: 12, display: "grid" }}>
          Meta description (optional)
          <input
            value={metaDesc}
            onChange={(e) => setMetaDesc(e.target.value)}
            placeholder="Short description for search engines"
          />
        </label>

        {/* AI generation row */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
            padding: "10px 12px",
            background: "var(--soft-blue)",
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--blue)" }}>
            Generate with AI
          </span>
          <select
            value={genType}
            onChange={(e) => setGenType(e.target.value as PageType)}
            style={{
              height: 32,
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "0 8px",
              fontFamily: "inherit",
              fontSize: 12,
            }}
          >
            <option value="about">About page</option>
            <option value="blog-post">Blog post</option>
            <option value="menu">Services / Menu</option>
            <option value="pricing">Pricing page</option>
            <option value="contact">Contact page</option>
          </select>
          <input
            value={genTopic}
            onChange={(e) => setGenTopic(e.target.value)}
            placeholder="Blog topic (optional)"
            style={{ width: 180, height: 32 }}
          />
          <button
            type="button"
            className="primary-button"
            style={{ minHeight: 32, fontSize: 12 }}
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating ? "Generating…" : "Generate"}
          </button>
        </div>

        {/* Block list */}
        <div className="page-editor" style={{ maxHeight: 380, overflowY: "auto", marginBottom: 12 }}>
          {blocks.length === 0 ? (
            <div
              style={{
                padding: "24px",
                textAlign: "center",
                color: "var(--muted)",
                fontSize: 13,
                border: "1px dashed var(--border)",
                borderRadius: 8,
              }}
            >
              No blocks yet. Add blocks below or use Generate with AI.
            </div>
          ) : (
            blocks.map((block, i) => (
              <div key={i} className="page-block">
                <div className="page-block-type">{block.type}</div>
                <div className="page-block-controls">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Move up"
                    disabled={i === 0}
                    onClick={() => moveBlock(i, -1)}
                    style={{ width: 26, minHeight: 26, fontSize: 12 }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Move down"
                    disabled={i === blocks.length - 1}
                    onClick={() => moveBlock(i, 1)}
                    style={{ width: 26, minHeight: 26, fontSize: 12 }}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Delete block"
                    onClick={() => removeBlock(i)}
                    style={{ width: 26, minHeight: 26, fontSize: 12, color: "#b42318" }}
                  >
                    ×
                  </button>
                </div>
                <div style={{ paddingRight: 80 }}>
                  <BlockEditor block={block} onChange={(updated) => updateBlock(i, updated)} />
                </div>
              </div>
            ))
          )}
        </div>

        {/* Add block row */}
        <div className="add-block-row" style={{ marginBottom: 16 }}>
          {BLOCK_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className="add-block-btn"
              onClick={() => addBlock(t)}
            >
              + {t}
            </button>
          ))}
        </div>

        {/* Publish toggle */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 16,
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <input
            type="checkbox"
            checked={published}
            onChange={(e) => setPublished(e.target.checked)}
            style={{ width: 16, height: 16 }}
          />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
            Published (visible on the live site)
          </span>
        </label>

        {error ? (
          <p className="wizard-error" style={{ marginBottom: 12 }}>
            {error}
          </p>
        ) : null}

        <div className="wizard-actions">
          <button type="button" className="ghost-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving…" : isNew ? "Create page" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard component
// ---------------------------------------------------------------------------

interface PagesDashboardProps {
  businessName?: string;
  industry?: string;
}

export function PagesDashboard({
  businessName = "",
  industry = "",
}: PagesDashboardProps) {
  const [state, dispatch] = useReducer(pagesReducer, { status: "idle" });
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<Partial<SitePageRecord> | null | false>(false);
  // false = editor closed; null = new page; object = editing existing page
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showNotice(msg: string) {
    setNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 4000);
  }

  const loadPages = useCallback(() => {
    dispatch({ type: "fetch" });
    fetch("/api/dashboard/pages")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ ok: boolean; pages: SitePageRecord[] }>;
      })
      .then(({ pages }) => dispatch({ type: "loaded", pages }))
      .catch((err: unknown) =>
        dispatch({
          type: "error",
          message: err instanceof Error ? err.message : "Failed to load pages",
        })
      );
  }, []);

  useEffect(() => {
    loadPages();
  }, [loadPages]);

  async function handleTogglePublish(page: SitePageRecord) {
    try {
      const res = await fetch("/api/dashboard/pages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: page.id, published: !page.published }),
      });
      const data = (await res.json()) as { ok: boolean; page?: SitePageRecord };
      if (data.ok && data.page) {
        dispatch({ type: "upsert", page: data.page });
        showNotice(data.page.published ? "Page published." : "Page unpublished.");
      }
    } catch {
      showNotice("Toggle failed. Try again.");
    }
  }

  async function handleDelete(page: SitePageRecord) {
    if (!confirm(`Delete "${page.title}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/dashboard/pages?id=${encodeURIComponent(page.id)}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { ok: boolean };
      if (data.ok) {
        dispatch({ type: "remove", id: page.id });
        showNotice("Page deleted.");
      }
    } catch {
      showNotice("Delete failed. Try again.");
    }
  }

  function handleSaved(page: SitePageRecord) {
    dispatch({ type: "upsert", page });
    setEditing(false);
  }

  const pages = state.status === "loaded" ? state.pages : [];

  return (
    <section>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 20,
          gap: 16,
        }}
      >
        <div>
          <h2 style={{ margin: "0 0 4px", fontSize: 22, color: "var(--heading)" }}>
            Pages
          </h2>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
            Add pages and blog posts to your site.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="ghost-button"
            onClick={() => setEditing(null)}
          >
            + New page
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => setEditing({ blocks: [{ type: "heading", text: "", level: 1 }, { type: "paragraph", text: "" }] })}
          >
            + New blog post
          </button>
        </div>
      </div>

      {/* Status notice */}
      <p className="sr-status" role="status" aria-live="polite" style={{ marginBottom: 8 }}>
        {notice}
      </p>

      {/* States */}
      {state.status === "loading" && (
        <div style={{ color: "var(--muted)", fontSize: 13, padding: "24px 0" }}>
          Loading pages…
        </div>
      )}

      {state.status === "error" && (
        <div style={{ color: "#b42318", fontSize: 13, padding: "12px 0" }}>
          {state.message}
          <button
            type="button"
            className="ghost-button"
            style={{ marginLeft: 12, minHeight: 28, fontSize: 12 }}
            onClick={loadPages}
          >
            Retry
          </button>
        </div>
      )}

      {state.status === "loaded" && pages.length === 0 && (
        <div
          style={{
            padding: "36px 24px",
            textAlign: "center",
            border: "1px dashed var(--border)",
            borderRadius: 8,
            color: "var(--muted)",
            fontSize: 13,
          }}
        >
          No pages yet. Create your first page or use AI to generate one.
        </div>
      )}

      {/* Pages list */}
      {state.status === "loaded" && pages.length > 0 && (
        <div className="pages-list panel">
          {pages.map((page) => (
            <div key={page.id} className="pages-list-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="pages-list-title">{page.title}</div>
                <div className="pages-list-path">{page.siteSlug}{page.path}</div>
              </div>

              <span
                className={`quiet-tag${page.published ? " success" : ""}`}
                style={{ fontSize: 11 }}
              >
                {page.published ? "Published" : "Draft"}
              </span>

              <span
                style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}
              >
                {new Date(page.updatedAt).toLocaleDateString("en-ZA")}
              </span>

              {/* Actions */}
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  className="ghost-button"
                  style={{ minHeight: 30, padding: "0 10px", fontSize: 12 }}
                  onClick={() => setEditing(page)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  style={{ minHeight: 30, padding: "0 10px", fontSize: 12 }}
                  onClick={() => handleTogglePublish(page)}
                >
                  {page.published ? "Unpublish" : "Publish"}
                </button>
                <a
                  href={`/s/${page.siteSlug}${page.path}`}
                  target="_blank"
                  rel="noreferrer"
                  className="ghost-button"
                  style={{ minHeight: 30, padding: "0 10px", fontSize: 12, textDecoration: "none" }}
                >
                  View
                </a>
                <button
                  type="button"
                  className="ghost-button"
                  style={{ minHeight: 30, padding: "0 10px", fontSize: 12, color: "#b42318" }}
                  onClick={() => handleDelete(page)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Page editor modal */}
      {editing !== false ? (
        <PageEditor
          page={editing}
          businessName={businessName}
          industry={industry}
          onClose={() => setEditing(false)}
          onSaved={handleSaved}
          onNotice={showNotice}
        />
      ) : null}
    </section>
  );
}
