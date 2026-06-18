"use client";

// W8 — Google Business Profile step (client, CLIENT-SAFE per the W3 lesson).
//
// Imports ONLY: React + icons, the GBP server ACTIONS by reference, and a
// type-only import of the listing view. It NEVER imports core/registry, the
// localListing service runtime, or any metering/crypto module — so no
// server-only module (and no UnhandledSchemeError) can leak into the client
// bundle.
//
// UX: review the single-source NAP (Name / area / Phone) pulled from the profile
// → pick a category → "List on Google" (approval) → shows pending-verification /
// live status.

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Loader2, MapPin, Star, XCircle } from "lucide-react";
import type { Business } from "@/lib/types";
import {
  getListingAction,
  runGbpGatedAction,
  type ListingView,
} from "@/app/gbp/actions";

interface Props {
  business: Business;
  authenticated: boolean;
  /** True when the tenant's plan unlocks discovery features (Growth+). */
  canList: boolean;
  onNotice: (message: string) => void;
}

// A short, friendly category list for the non-technical owner (GBP has many,
// but a curated set keeps the picker simple; "Other" lets them type one).
const CATEGORY_OPTIONS = [
  "Plumber",
  "Electrician",
  "Hair Salon",
  "Restaurant",
  "Spaza Shop",
  "Mechanic",
  "Tutor",
  "Cleaning Service",
  "Other",
];

function statusLabel(status: string | undefined): {
  text: string;
  className: string;
  icon: React.ReactNode;
} {
  switch (status) {
    case "live":
      return { text: "Live on Google", className: "gbp-status live", icon: <CheckCircle2 size={14} /> };
    case "pending_verification":
      return { text: "Pending verification", className: "gbp-status pending", icon: <Clock size={14} /> };
    case "failed":
      return { text: "Verification failed", className: "gbp-status failed", icon: <XCircle size={14} /> };
    default:
      return { text: "Not listed yet", className: "gbp-status draft", icon: <MapPin size={14} /> };
  }
}

export function GbpStep({ business, authenticated, canList, onNotice }: Props) {
  const [view, setView] = useState<ListingView | null>(null);
  const [category, setCategory] = useState(CATEGORY_OPTIONS[0]);
  const [customCategory, setCustomCategory] = useState("");
  const [stepUp, setStepUp] = useState(false);
  const [listing, setListing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authenticated) return;
    let active = true;
    void getListingAction(business)
      .then((v) => {
        if (active) setView(v);
      })
      .catch(() => {
        /* read-only; ignore transient errors */
      });
    return () => {
      active = false;
    };
    // Re-read when the relevant NAP fields change (not the whole object, which
    // would re-fetch on every keystroke of an unrelated field).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, business.name, business.location, business.whatsapp]);

  async function list() {
    setError("");
    if (!authenticated) {
      onNotice("Sign in to list your business on Google.");
      return;
    }
    if (!canList) {
      onNotice("Listing on Google is a Growth feature — upgrade to unlock it.");
      return;
    }
    if (!view?.napComplete) {
      setError("Add your business name, area, and a valid SA mobile number first.");
      return;
    }
    if (!stepUp) {
      setError("Tick the confirmation to authorise listing on Google.");
      return;
    }
    const chosen = category === "Other" ? customCategory.trim() : category;
    if (!chosen) {
      setError("Choose or type a category for your business.");
      return;
    }
    setListing(true);
    try {
      const result = await runGbpGatedAction({
        verb: "gbp.create",
        business,
        category: chosen,
        stepUp: true,
      });
      if (result.status === "denied") {
        setError(result.detail);
      } else {
        onNotice(`Listing on Google: ${result.detail}`);
        const refreshed = await getListingAction(business);
        setView(refreshed);
      }
    } catch {
      setError("Could not list on Google — please try again.");
    } finally {
      setListing(false);
    }
  }

  const nap = view?.nap;
  const status = statusLabel(view?.listing?.status);
  const alreadyListed =
    view?.listing?.status === "pending_verification" ||
    view?.listing?.status === "live";

  return (
    <section className="panel gbp-step">
      <div className="section-heading">
        <div>
          <h2>
            <MapPin size={18} /> Get found on Google
          </h2>
          <p>
            List your business on Google so customers nearby can find you — we use
            the details from your profile.
          </p>
        </div>
        <span className={status.className}>
          {status.icon}
          {status.text}
        </span>
      </div>

      <div className="gbp-nap">
        <h3>What we&apos;ll show on Google</h3>
        <ul>
          <li>
            <span>Name</span>
            <strong>{nap?.name || "—"}</strong>
          </li>
          <li>
            <span>Area</span>
            <strong>{nap?.area || "—"}</strong>
          </li>
          <li>
            <span>Phone</span>
            <strong>{nap?.phone || "—"}</strong>
          </li>
        </ul>
        {view && !view.napComplete ? (
          <p className="wizard-hint">
            Complete your name, area, and a valid SA mobile number in your profile
            to list on Google.
          </p>
        ) : null}
      </div>

      <label className="field">
        <span>
          <Star size={14} /> Your main category
        </span>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      {category === "Other" ? (
        <label className="field">
          <span>Type your category</span>
          <input
            type="text"
            value={customCategory}
            placeholder="e.g. Photographer"
            onChange={(e) => setCustomCategory(e.target.value)}
          />
        </label>
      ) : null}

      {error ? <p className="wizard-error">{error}</p> : null}

      {!alreadyListed ? (
        <>
          <label className="field field-inline gbp-stepup">
            <input
              type="checkbox"
              checked={stepUp}
              onChange={(e) => setStepUp(e.target.checked)}
            />
            <span>I am the owner and I authorise listing this business on Google.</span>
          </label>
          <button
            className="primary-button"
            type="button"
            onClick={list}
            disabled={listing}
          >
            {listing ? <Loader2 size={16} className="spin" /> : <MapPin size={16} />}
            {listing ? "Listing…" : "List on Google"}
          </button>
        </>
      ) : (
        <p className="gbp-listed-note">
          {view?.listing?.status === "live"
            ? "Your business is live on Google."
            : "Google is verifying your listing — this can take a little while."}
        </p>
      )}
    </section>
  );
}
