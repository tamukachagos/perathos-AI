"use client";

// POPIA consent banner for published customer sites (M5).
//
// Non-essential scripts (analytics, pixels, etc.) MUST NOT run until the visitor
// accepts. This component is the gate: it renders a small banner, persists the
// choice in localStorage, and exposes the decision so a published site only ever
// injects non-essential scripts AFTER acceptance. It is deliberately tiny — a
// single client island, no dependencies — to respect the site's JS budget on SA
// low-bandwidth connections.
//
// How a published site uses the decision: non-essential scripts are rendered
// conditionally on `accepted`, so until the visitor clicks "Accept" they are
// never added to the DOM. Essential content (the page itself, the lead form)
// always renders regardless of the banner.

import { useEffect, useState } from "react";

const STORAGE_KEY = "ld-consent";
type Choice = "accepted" | "declined";

function readChoice(): Choice | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "accepted" || v === "declined" ? v : null;
  } catch {
    return null;
  }
}

/**
 * Read the current non-essential-scripts consent decision (client-only).
 * Returns true only when the visitor has explicitly accepted.
 */
export function hasConsent(): boolean {
  if (typeof window === "undefined") return false;
  return readChoice() === "accepted";
}

export function ConsentBanner({
  onChange,
}: {
  /** Called with the decision so a parent can gate non-essential scripts. */
  onChange?: (accepted: boolean) => void;
}) {
  // Render nothing until we know the stored choice, so the banner never flashes
  // for visitors who already decided.
  const [choice, setChoice] = useState<Choice | null | undefined>(undefined);

  useEffect(() => {
    const stored = readChoice();
    setChoice(stored);
    if (stored) onChange?.(stored === "accepted");
  }, [onChange]);

  function decide(next: Choice) {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage blocked: still honour the choice for this page view.
    }
    setChoice(next);
    onChange?.(next === "accepted");
  }

  // Already decided, or not yet hydrated: show nothing.
  if (choice === undefined || choice !== null) return null;

  return (
    <div className="consent-banner" role="dialog" aria-live="polite" aria-label="Privacy consent">
      <p>
        We use only essential cookies to show this page. Allow optional analytics
        to help this business improve?{" "}
        <a href="/privacy" target="_blank" rel="noreferrer">
          Privacy policy
        </a>
        .
      </p>
      <div className="consent-actions">
        <button type="button" className="public-secondary" onClick={() => decide("declined")}>
          Essential only
        </button>
        <button type="button" className="public-primary" onClick={() => decide("accepted")}>
          Accept
        </button>
      </div>
    </div>
  );
}
