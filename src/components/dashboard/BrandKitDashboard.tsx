"use client";

// Brand Kit Dashboard — logo generation, color palette, tagline, font picker,
// and a live mini brand-preview. Calls:
//   POST /api/brand/generate    — Flux Schnell logo generation (3 options)
//   POST /api/brand/tagline     — CHEAP-tier LLM tagline generation (3 options)
//   GET  /api/dashboard/brand   — fetch existing BrandKit on mount
//   PATCH /api/dashboard/brand  — persist all changes on Save

import { useCallback, useEffect, useState } from "react";
import { Loader2, Palette, Save, Sparkles, Type } from "lucide-react";
import type { Business } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LogoStyle = "modern" | "classic" | "bold" | "minimal";
type FontFamily =
  | "Inter"
  | "Playfair Display"
  | "Montserrat"
  | "Roboto Slab"
  | "Poppins";

interface StyleOption {
  key: LogoStyle;
  name: string;
  desc: string;
  preview: string; // Short visual description shown in the card body
}

const STYLE_OPTIONS: StyleOption[] = [
  {
    key: "modern",
    name: "Modern",
    desc: "Flat, minimal, geometric",
    preview: "Clean shapes · Blue & white · Professional",
  },
  {
    key: "classic",
    name: "Classic",
    desc: "Timeless, crest-style",
    preview: "Gold & navy · Elegant · Traditional",
  },
  {
    key: "bold",
    name: "Bold",
    desc: "Strong, high-impact",
    preview: "Vibrant colours · Geometric · Dynamic",
  },
  {
    key: "minimal",
    name: "Minimal",
    desc: "Ultra-clean, wordmark",
    preview: "Single colour · Refined · Pure",
  },
];

const FONT_OPTIONS: FontFamily[] = [
  "Inter",
  "Playfair Display",
  "Montserrat",
  "Roboto Slab",
  "Poppins",
];

// Industry → suggested colour palette
const INDUSTRY_PALETTES: Record<
  string,
  { primary: string; secondary: string; accent: string }
> = {
  restaurant: { primary: "#c0392b", secondary: "#2c3e50", accent: "#f39c12" },
  retail: { primary: "#8e44ad", secondary: "#2c3e50", accent: "#f1c40f" },
  tech: { primary: "#2980b9", secondary: "#1a252f", accent: "#27ae60" },
  health: { primary: "#27ae60", secondary: "#1a3c34", accent: "#2ecc71" },
  finance: { primary: "#123a6f", secondary: "#1a252f", accent: "#ffc457" },
  education: { primary: "#2471a3", secondary: "#1b2631", accent: "#f39c12" },
  construction: { primary: "#d35400", secondary: "#1c2833", accent: "#f0b27a" },
  beauty: { primary: "#c0392b", secondary: "#4a235a", accent: "#f9a8d4" },
};

function industryPalette(industry: string) {
  const key = industry.toLowerCase();
  for (const [k, v] of Object.entries(INDUSTRY_PALETTES)) {
    if (key.includes(k)) return v;
  }
  // Generic SA-themed default (deep green + blue)
  return { primary: "#0f7a4f", secondary: "#123a6f", accent: "#ffc457" };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  business: Business;
  authenticated: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BrandKitDashboard({ business, authenticated }: Props) {
  // --- Persisted BrandKit state
  const [brandKitId, setBrandKitId] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  // --- Logo generation
  const [selectedStyle, setSelectedStyle] = useState<LogoStyle>("modern");
  const [generating, setGenerating] = useState(false);
  const [logoOptions, setLogoOptions] = useState<string[]>([]);
  const [selectedLogo, setSelectedLogo] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState("");

  // --- Colours
  const [primaryColor, setPrimaryColor] = useState("#0f7a4f");
  const [secondaryColor, setSecondaryColor] = useState("#123a6f");
  const [accentColor, setAccentColor] = useState("#ffc457");

  // --- Tagline
  const [tagline, setTagline] = useState("");
  const [taglineOptions, setTaglineOptions] = useState<string[]>([]);
  const [taglineLoading, setTaglineLoading] = useState(false);
  const [taglineError, setTaglineError] = useState("");

  // --- Font
  const [fontFamily, setFontFamily] = useState<FontFamily>("Inter");

  // --- Save
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");

  // --- Load existing BrandKit on mount
  useEffect(() => {
    if (!authenticated) return;
    void fetch("/api/dashboard/brand")
      .then((r) => r.json())
      .then((data: { ok: boolean; brandKit: {
        id?: string;
        logoUrl?: string | null;
        primaryColor?: string | null;
        secondaryColor?: string | null;
        accentColor?: string | null;
        fontFamily?: string | null;
        tagline?: string | null;
      } | null }) => {
        if (!data.ok || !data.brandKit) return;
        const bk = data.brandKit;
        if (bk.id) setBrandKitId(bk.id);
        if (bk.logoUrl) {
          setLogoUrl(bk.logoUrl);
          setSelectedLogo(bk.logoUrl);
        }
        if (bk.primaryColor) setPrimaryColor(bk.primaryColor);
        if (bk.secondaryColor) setSecondaryColor(bk.secondaryColor);
        if (bk.accentColor) setAccentColor(bk.accentColor);
        if (bk.fontFamily) setFontFamily(bk.fontFamily as FontFamily);
        if (bk.tagline) setTagline(bk.tagline);
      })
      .catch(() => {
        // Silently ignore — component still usable
      });
  }, [authenticated]);

  // --- Generate logos
  const handleGenerate = useCallback(async () => {
    if (!authenticated) return;
    setGenerating(true);
    setGenerateError("");
    setLogoOptions([]);
    try {
      const res = await fetch("/api/brand/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: business.name || "My Business",
          industry: business.industry || "business",
          style: selectedStyle,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        logos?: string[];
        brandKitId?: string;
        error?: string;
      };
      if (!data.ok) {
        setGenerateError(data.error ?? "Generation failed. Please try again.");
        return;
      }
      const logos = data.logos ?? [];
      setLogoOptions(logos);
      if (logos[0]) setSelectedLogo(logos[0]);
      if (data.brandKitId) setBrandKitId(data.brandKitId);
    } catch {
      setGenerateError("Network error. Please try again.");
    } finally {
      setGenerating(false);
    }
  }, [authenticated, business.name, business.industry, selectedStyle]);

  // --- Suggest colours from industry
  const handleAutoColors = useCallback(() => {
    const palette = industryPalette(business.industry || "");
    setPrimaryColor(palette.primary);
    setSecondaryColor(palette.secondary);
    setAccentColor(palette.accent);
  }, [business.industry]);

  // --- Generate taglines
  const handleGenerateTaglines = useCallback(async () => {
    if (!authenticated) return;
    setTaglineLoading(true);
    setTaglineError("");
    setTaglineOptions([]);
    try {
      const res = await fetch("/api/brand/tagline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: business.name || "My Business",
          industry: business.industry || "business",
          location: business.location || "South Africa",
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        taglines?: string[];
        error?: string;
      };
      if (!data.ok) {
        setTaglineError(data.error ?? "Tagline generation failed.");
        return;
      }
      setTaglineOptions(data.taglines ?? []);
    } catch {
      setTaglineError("Network error. Please try again.");
    } finally {
      setTaglineLoading(false);
    }
  }, [authenticated, business.name, business.industry, business.location]);

  // --- Save brand kit
  const handleSave = useCallback(async () => {
    if (!authenticated) return;
    setSaving(true);
    setSaveStatus("");
    try {
      const res = await fetch("/api/dashboard/brand", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          logoUrl: selectedLogo ?? logoUrl,
          primaryColor,
          secondaryColor,
          accentColor,
          fontFamily,
          tagline,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        brandKit?: { id?: string };
        error?: string;
      };
      if (data.ok) {
        if (data.brandKit?.id) setBrandKitId(data.brandKit.id);
        setSaveStatus("Brand kit saved.");
        setTimeout(() => setSaveStatus(""), 3000);
      } else {
        setSaveStatus(`Save failed: ${data.error ?? "unknown error"}`);
      }
    } catch {
      setSaveStatus("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [
    authenticated,
    selectedLogo,
    logoUrl,
    primaryColor,
    secondaryColor,
    accentColor,
    fontFamily,
    tagline,
  ]);

  // The logo to show in the preview
  const previewLogo = selectedLogo ?? logoUrl;
  const previewName = business.name || "Your Business";

  return (
    <section className="panel profile-panel brand-kit">
      {/* Header */}
      <div className="section-heading">
        <div>
          <h2>Brand Kit</h2>
          <p>Generate a logo, set your colours, and craft your tagline.</p>
        </div>
        {brandKitId ? (
          <span className="quiet-tag success">Saved</span>
        ) : (
          <span className="quiet-tag">New</span>
        )}
      </div>

      {/* ── Logo generation ── */}
      <div style={{ marginBottom: 20 }}>
        <p style={{ margin: "0 0 10px", fontWeight: 720, color: "var(--heading)", fontSize: 14 }}>
          Generate Logo
        </p>

        {/* Style picker */}
        <div className="brand-style-grid">
          {STYLE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`brand-style-card${selectedStyle === opt.key ? " selected" : ""}`}
              onClick={() => setSelectedStyle(opt.key)}
            >
              <div className="brand-style-name">{opt.name}</div>
              <div className="brand-style-desc">{opt.desc}</div>
              <div className="brand-style-desc" style={{ marginTop: 6, fontStyle: "italic" }}>
                {opt.preview}
              </div>
            </button>
          ))}
        </div>

        {/* Generate button */}
        <button
          type="button"
          className="primary-button"
          disabled={!authenticated || generating}
          onClick={() => void handleGenerate()}
          style={{ width: "100%" }}
        >
          {generating ? (
            <>
              <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
              Generating 3 options...
            </>
          ) : (
            <>
              <Sparkles size={14} />
              Generate 3 Logo Options
            </>
          )}
        </button>
        {generateError && (
          <p className="field-error" style={{ marginTop: 6 }}>
            {generateError}
          </p>
        )}

        {/* Logo option grid */}
        {logoOptions.length > 0 && (
          <div className="brand-logo-grid">
            {logoOptions.map((url, i) => (
              <button
                key={i}
                type="button"
                className={`brand-logo-option${selectedLogo === url ? " selected" : ""}`}
                onClick={() => setSelectedLogo(url)}
                aria-label={`Logo option ${i + 1}`}
              >
                {url.startsWith("data:") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={`Logo option ${i + 1}`} />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={url}
                    alt={`Logo option ${i + 1}`}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Colour palette ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <p style={{ margin: 0, fontWeight: 720, color: "var(--heading)", fontSize: 14 }}>
            <Palette size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />
            Colour Palette
          </p>
          <button
            type="button"
            className="ghost-button"
            style={{ fontSize: 12, minHeight: 30 }}
            onClick={handleAutoColors}
          >
            Auto from industry
          </button>
        </div>

        {/* Primary */}
        <div className="brand-color-row">
          <label htmlFor="bk-primary" style={{ minWidth: 100, color: "var(--muted)", fontSize: 12, fontWeight: 720, gap: 0 }}>
            Primary
          </label>
          <input
            type="color"
            id="bk-primary"
            className="brand-color-swatch"
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
            title="Primary colour"
          />
          <input
            id="bk-primary-hex"
            value={primaryColor}
            onChange={(e) => setPrimaryColor(e.target.value)}
            style={{ width: 100 }}
            maxLength={7}
            aria-label="Primary colour hex"
          />
        </div>

        {/* Secondary */}
        <div className="brand-color-row">
          <label htmlFor="bk-secondary" style={{ minWidth: 100, color: "var(--muted)", fontSize: 12, fontWeight: 720, gap: 0 }}>
            Secondary
          </label>
          <input
            type="color"
            id="bk-secondary"
            className="brand-color-swatch"
            value={secondaryColor}
            onChange={(e) => setSecondaryColor(e.target.value)}
            title="Secondary colour"
          />
          <input
            id="bk-secondary-hex"
            value={secondaryColor}
            onChange={(e) => setSecondaryColor(e.target.value)}
            style={{ width: 100 }}
            maxLength={7}
            aria-label="Secondary colour hex"
          />
        </div>

        {/* Accent */}
        <div className="brand-color-row">
          <label htmlFor="bk-accent" style={{ minWidth: 100, color: "var(--muted)", fontSize: 12, fontWeight: 720, gap: 0 }}>
            Accent
          </label>
          <input
            type="color"
            id="bk-accent"
            className="brand-color-swatch"
            value={accentColor}
            onChange={(e) => setAccentColor(e.target.value)}
            title="Accent colour"
          />
          <input
            id="bk-accent-hex"
            value={accentColor}
            onChange={(e) => setAccentColor(e.target.value)}
            style={{ width: 100 }}
            maxLength={7}
            aria-label="Accent colour hex"
          />
        </div>
      </div>

      {/* ── Tagline generator ── */}
      <div style={{ marginBottom: 20 }}>
        <p style={{ margin: "0 0 10px", fontWeight: 720, color: "var(--heading)", fontSize: 14 }}>
          Tagline
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            id="bk-tagline"
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="Your business tagline..."
            style={{ flex: 1 }}
            aria-label="Tagline"
          />
          <button
            type="button"
            className="ghost-button"
            disabled={!authenticated || taglineLoading}
            onClick={() => void handleGenerateTaglines()}
            style={{ whiteSpace: "nowrap" }}
          >
            {taglineLoading ? (
              <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
            ) : (
              <Sparkles size={13} />
            )}
            Generate
          </button>
        </div>
        {taglineError && (
          <p className="field-error" style={{ marginBottom: 8 }}>
            {taglineError}
          </p>
        )}
        {taglineOptions.length > 0 && (
          <div style={{ display: "grid", gap: 6 }}>
            {taglineOptions.map((t, i) => (
              <button
                key={i}
                type="button"
                className={`check-row${tagline === t ? " selected" : ""}`}
                style={{ minHeight: 40 }}
                onClick={() => setTagline(t)}
              >
                <span style={{ gridColumn: "2", color: "var(--heading)", fontWeight: 600, fontSize: 13 }}>
                  {t}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Font family selector ── */}
      <div style={{ marginBottom: 20 }}>
        <p style={{ margin: "0 0 10px", fontWeight: 720, color: "var(--heading)", fontSize: 14 }}>
          <Type size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />
          Font Family
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {FONT_OPTIONS.map((font) => (
            <button
              key={font}
              type="button"
              className={`ghost-button${fontFamily === font ? " is-active" : ""}`}
              style={{
                fontFamily: `'${font}', sans-serif`,
                fontSize: 13,
                minHeight: 34,
                ...(fontFamily === font
                  ? { borderColor: "var(--blue)", color: "var(--blue)", background: "var(--soft-blue)" }
                  : {}),
              }}
              onClick={() => setFontFamily(font)}
            >
              {font}
            </button>
          ))}
        </div>
      </div>

      {/* ── Brand preview ── */}
      <div className="brand-preview">
        <p style={{ margin: "0 0 12px", fontWeight: 720, color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Preview
        </p>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 10,
          }}
        >
          {/* Logo */}
          {previewLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewLogo}
              alt="Brand logo"
              style={{ width: 56, height: 56, objectFit: "contain", borderRadius: 8, background: "#fff", padding: 4, border: "1px solid var(--border)" }}
            />
          ) : (
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 8,
                background: primaryColor,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontWeight: 800,
                fontSize: 18,
              }}
            >
              {previewName.slice(0, 2).toUpperCase()}
            </div>
          )}
          {/* Name + colour dots */}
          <div>
            <strong
              style={{
                display: "block",
                fontFamily: `'${fontFamily}', sans-serif`,
                fontSize: 18,
                color: "var(--heading)",
              }}
            >
              {previewName}
            </strong>
            {tagline && (
              <span style={{ color: "var(--muted)", fontSize: 12, fontStyle: "italic" }}>
                {tagline}
              </span>
            )}
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <span
                title={`Primary: ${primaryColor}`}
                style={{ width: 18, height: 18, borderRadius: 4, background: primaryColor, border: "1px solid var(--border)" }}
              />
              <span
                title={`Secondary: ${secondaryColor}`}
                style={{ width: 18, height: 18, borderRadius: 4, background: secondaryColor, border: "1px solid var(--border)" }}
              />
              <span
                title={`Accent: ${accentColor}`}
                style={{ width: 18, height: 18, borderRadius: 4, background: accentColor, border: "1px solid var(--border)" }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Save button ── */}
      <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <button
          type="button"
          className="primary-button"
          disabled={!authenticated || saving}
          onClick={() => void handleSave()}
        >
          {saving ? (
            <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
          ) : (
            <Save size={14} />
          )}
          Save Brand Kit
        </button>
        {saveStatus && (
          <p
            className="sr-status"
            style={{ color: saveStatus.startsWith("Save failed") || saveStatus.startsWith("Network") ? "#b42318" : "var(--green)" }}
          >
            {saveStatus}
          </p>
        )}
      </div>

      {!authenticated && (
        <p className="field-error" style={{ marginTop: 10 }}>
          Sign in to generate logos and save your brand kit.
        </p>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </section>
  );
}
