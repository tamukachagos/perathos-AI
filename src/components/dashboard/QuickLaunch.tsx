"use client";

// Zero-conversation fast-lane onboarding card. Shown above the template grid
// and example prompts in the AssistantConsole EmptyState. Collects 4 fields,
// POSTs to /api/onboard/quick, and auto-applies the returned profile without
// any back-and-forth chat. The "Describe it instead" link hides this card and
// hands focus back to the chat composer.

import { useState } from "react";
import type { Business } from "@/lib/types";

const INDUSTRIES = [
  "Beauty & Wellness",
  "Food & Hospitality",
  "Trades & Services",
  "Education & Training",
  "Cleaning Services",
  "Creative & Media",
  "Retail",
  "Professional Services",
  "Other",
] as const;

type Step = "form" | "progress" | "done";

interface Props {
  /** Apply the generated profile to the shell's business state. */
  onApplyProfile: (profile: Business) => void;
  /** Switch the shell to the Preview tab. */
  onOpenPreview: () => void;
  /** Called when the user clicks "Describe it instead →" to hide this card. */
  onSkip: () => void;
}

const PROGRESS_STEPS = [
  "Setting up your business profile...",
  "Generating your site...",
  "Almost ready!",
];

export function QuickLaunch({ onApplyProfile, onOpenPreview, onSkip }: Props) {
  const [step, setStep] = useState<Step>("form");
  const [progressIdx, setProgressIdx] = useState(0);
  const [error, setError] = useState("");
  const [domain, setDomain] = useState<string | null>(null);
  const [domainAvailable, setDomainAvailable] = useState<boolean | null>(null);

  // Form fields
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [location, setLocation] = useState("");
  const [phone, setPhone] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Please enter your business name.");
      return;
    }
    if (!industry) {
      setError("Please select your industry.");
      return;
    }
    setError("");
    setStep("progress");
    setProgressIdx(0);

    // Cycle through progress messages while we wait
    const interval = setInterval(() => {
      setProgressIdx((i) => Math.min(i + 1, PROGRESS_STEPS.length - 1));
    }, 1100);

    try {
      const res = await fetch("/api/onboard/quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          industry,
          location: location.trim(),
          phone: phone.trim(),
        }),
      });
      const json = await res.json() as {
        ok: boolean;
        profile?: Business;
        suggestedDomain?: string;
        available?: boolean;
        error?: string;
      };

      clearInterval(interval);

      if (!res.ok || !json.ok || !json.profile) {
        setStep("form");
        setError(json.error ?? "Something went wrong — please try again.");
        return;
      }

      onApplyProfile(json.profile);
      setDomain(json.suggestedDomain ?? null);
      setDomainAvailable(json.available ?? null);
      setStep("done");
    } catch {
      clearInterval(interval);
      setStep("form");
      setError("Network error — please check your connection and try again.");
    }
  }

  if (step === "progress") {
    return (
      <div className="quick-launch">
        <div className="quick-launch-progress" aria-live="polite">
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              border: "3px solid rgba(255,255,255,0.3)",
              borderTopColor: "#fff",
              animation: "ql-spin 0.8s linear infinite",
              margin: "0 auto 16px",
            }}
          />
          <p className="quick-launch-step">{PROGRESS_STEPS[progressIdx]}</p>
        </div>
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="quick-launch">
        <h2>Your site is ready!</h2>
        <p>
          We have set up your business profile and built a starter site.
          {domain && domainAvailable === true ? ` The domain ${domain} is available.` : ""}
          {domain && domainAvailable === false ? ` ${domain} is taken — you can choose another in Settings.` : ""}
        </p>
        <button
          className="quick-launch-btn"
          type="button"
          onClick={onOpenPreview}
        >
          Open Preview
        </button>
        <button
          className="quick-launch-skip"
          type="button"
          onClick={onSkip}
        >
          Continue in chat
        </button>
      </div>
    );
  }

  return (
    <div className="quick-launch">
      <h2>Launch your business online in 2 minutes</h2>
      <p>
        Fill in 4 quick details — we handle everything else automatically.
      </p>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <div className="quick-launch-grid">
          <input
            className="quick-launch-field"
            type="text"
            placeholder="Business name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            aria-label="Business name"
          />
          <select
            className="quick-launch-field"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            required
            aria-label="Industry"
          >
            <option value="" disabled>Industry</option>
            {INDUSTRIES.map((ind) => (
              <option key={ind} value={ind}>{ind}</option>
            ))}
          </select>
          <input
            className="quick-launch-field"
            type="text"
            placeholder="Location (e.g. Soweto, Gauteng)"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            aria-label="Location"
          />
          <input
            className="quick-launch-field"
            type="tel"
            placeholder="Phone / WhatsApp number"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-label="Phone or WhatsApp number"
          />
        </div>
        {error ? (
          <p style={{ color: "#ffd6d6", fontSize: 13, margin: "0 0 10px" }}>
            {error}
          </p>
        ) : null}
        <button className="quick-launch-btn" type="submit">
          Launch Now
        </button>
      </form>
      <button className="quick-launch-skip" type="button" onClick={onSkip}>
        Describe it instead &rarr;
      </button>
    </div>
  );
}
