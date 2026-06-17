"use client";

// Onboarding wizard (M3): "describe your business in plain language" → the mock
// AgentProvider generates a structured profile → the user REVIEWS and edits it
// → on confirm it populates the dashboard. Lightweight, consistent with the
// existing dashboard styling (reuses .panel / .ghost-button / .primary-button).

import { useState } from "react";
import { Sparkles, Wand2, X } from "lucide-react";
import type { Business } from "@/lib/types";

interface Props {
  /** Apply the reviewed profile to the dashboard draft and close. */
  onApply: (profile: Business) => void;
  onClose: () => void;
}

type Phase = "describe" | "review";

const EXAMPLE =
  "We run a mobile spa called Maboneng Mobile Spa in Johannesburg. We offer massages, facials and nail care at clients' homes, with same-week booking.";

export function OnboardingWizard({ onApply, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("describe");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Business | null>(null);
  const [lowConfidence, setLowConfidence] = useState<(keyof Business)[]>([]);

  async function generate() {
    setError("");
    if (description.trim().length < 10) {
      setError("Tell us a little more about your business (a sentence or two).");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/agent/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError("Could not generate a profile — please rephrase and try again.");
        return;
      }
      setDraft(json.profile as Business);
      setLowConfidence((json.lowConfidence ?? []) as (keyof Business)[]);
      setPhase("review");
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  function updateField(field: keyof Business, value: string) {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  const reviewFields: Array<{ key: keyof Business; label: string }> = [
    { key: "name", label: "Business name" },
    { key: "industry", label: "Industry" },
    { key: "location", label: "Location" },
    { key: "offer", label: "What you offer" },
    { key: "services", label: "Services" },
    { key: "tone", label: "Tone of voice" },
  ];

  return (
    <div className="wizard-overlay" role="dialog" aria-modal="true" aria-label="Onboarding wizard">
      <div className="wizard-panel panel">
        <header className="section-heading">
          <div>
            <h2>
              <Sparkles size={18} /> Describe your business
            </h2>
            <p>
              {phase === "describe"
                ? "Write a sentence or two in plain language. The assistant drafts a structured profile you can review."
                : "Review the draft. Edit anything that looks off, then apply it to your dashboard."}
            </p>
          </div>
          <button className="ghost-button" type="button" onClick={onClose} aria-label="Close wizard">
            <X size={16} />
          </button>
        </header>

        {phase === "describe" ? (
          <div className="wizard-body">
            <label className="field">
              <span>Tell us about your business</span>
              <textarea
                rows={5}
                value={description}
                placeholder={EXAMPLE}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <button
              className="ghost-button"
              type="button"
              onClick={() => setDescription(EXAMPLE)}
            >
              Use an example
            </button>
            {error ? <p className="wizard-error">{error}</p> : null}
            <div className="wizard-actions">
              <button className="ghost-button" type="button" onClick={onClose}>
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={generate}
                disabled={busy}
              >
                <Wand2 size={16} />
                {busy ? "Generating…" : "Generate profile"}
              </button>
            </div>
          </div>
        ) : draft ? (
          <div className="wizard-body">
            <div className="wizard-fields">
              {reviewFields.map((f) => (
                <label className="field" key={f.key}>
                  <span>
                    {f.label}
                    {lowConfidence.includes(f.key) ? (
                      <em className="wizard-flag"> · please check</em>
                    ) : null}
                  </span>
                  {f.key === "offer" ? (
                    <textarea
                      rows={2}
                      value={draft[f.key]}
                      onChange={(e) => updateField(f.key, e.target.value)}
                    />
                  ) : (
                    <input
                      type="text"
                      value={draft[f.key]}
                      onChange={(e) => updateField(f.key, e.target.value)}
                    />
                  )}
                </label>
              ))}
            </div>
            {error ? <p className="wizard-error">{error}</p> : null}
            <div className="wizard-actions">
              <button
                className="ghost-button"
                type="button"
                onClick={() => setPhase("describe")}
              >
                Back
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => onApply(draft)}
              >
                Apply to dashboard
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
