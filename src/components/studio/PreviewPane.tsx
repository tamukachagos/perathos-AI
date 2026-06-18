"use client";

// Launch Studio — Preview pane. A device-framed iframe of the owner's live site
// (/s/[slug]), with a desktop/mobile toggle, a refresh button, and a
// publish/update button that calls the EXISTING publish flow (passed in by the
// shell so this stays client-safe — no server module imports here).
//
// When nothing is published yet it shows a friendly "Publish to see your site"
// state. Non-technical throughout: "Update site" not "deploy", "your site" not
// "the build".

import { useMemo, useRef, useState } from "react";
import { Monitor, RefreshCw, Rocket, Smartphone } from "lucide-react";

interface Props {
  /** Slug of the current/most-recent published site, or null when none yet. */
  slug: string | null;
  /** True once at least one site is published (controls the empty state). */
  published: boolean;
  /** Plain-language label for the publish button ("Publish site" / "Update site"). */
  publishLabel: string;
  /** Calls the shell's publish handler (which wraps the existing publish flow). */
  onPublish: () => void | Promise<void>;
}

type Device = "desktop" | "mobile";

export function PreviewPane({ slug, published, publishLabel, onPublish }: Props) {
  const [device, setDevice] = useState<Device>("desktop");
  const [busy, setBusy] = useState(false);
  // A nonce appended to the iframe src to force a reload on "refresh".
  const [nonce, setNonce] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const src = useMemo(() => {
    if (!slug || !published) return null;
    const q = nonce > 0 ? `?r=${nonce}` : "";
    return `/s/${slug}${q}`;
  }, [slug, published, nonce]);

  async function publish() {
    setBusy(true);
    try {
      await onPublish();
      // Give the publish a beat, then refresh the frame so the owner sees it.
      setNonce((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="studio-preview">
      <div className="studio-preview-toolbar">
        <div className="studio-device-toggle" role="group" aria-label="Preview size">
          <button
            type="button"
            className={device === "desktop" ? "is-active" : ""}
            onClick={() => setDevice("desktop")}
            aria-pressed={device === "desktop"}
            title="Desktop view"
          >
            <Monitor size={15} />
            <span>Desktop</span>
          </button>
          <button
            type="button"
            className={device === "mobile" ? "is-active" : ""}
            onClick={() => setDevice("mobile")}
            aria-pressed={device === "mobile"}
            title="Phone view"
          >
            <Smartphone size={15} />
            <span>Phone</span>
          </button>
        </div>

        <div className="studio-preview-actions">
          <button
            type="button"
            className="ghost-button"
            onClick={() => setNonce((n) => n + 1)}
            disabled={!src}
            title="Refresh the preview"
          >
            <RefreshCw size={15} />
            Refresh
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={publish}
            disabled={busy}
          >
            <Rocket size={15} />
            {busy ? "Working…" : publishLabel}
          </button>
        </div>
      </div>

      <div className="studio-preview-stage">
        {src ? (
          <div className={`studio-frame device-${device}`}>
            <iframe
              ref={frameRef}
              key={`${src}`}
              src={src}
              title="Your live site preview"
              loading="lazy"
            />
          </div>
        ) : (
          <div className="studio-preview-empty">
            <div className="studio-preview-empty-card">
              <Rocket size={26} />
              <h3>Your site appears here</h3>
              <p>
                Tell the assistant about your business, or fill in your profile,
                then hit <strong>{publishLabel}</strong>. We&apos;ll put it online
                and show it right here.
              </p>
              <button
                type="button"
                className="primary-button"
                onClick={publish}
                disabled={busy}
              >
                <Rocket size={15} />
                {busy ? "Working…" : publishLabel}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
