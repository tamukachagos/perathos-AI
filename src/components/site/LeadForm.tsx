"use client";

import { useState } from "react";

// POPIA-by-default: a purpose statement, an un-ticked separate marketing opt-in,
// and explicit consent that must be given before the enquiry can be sent. On
// submit the form POSTs to /api/leads, which persists the lead ONLY when consent
// is true and records the consent timestamp + retention server-side.
export function LeadForm({ business, slug }: { business: string; slug: string }) {
  const [form, setForm] = useState({
    name: "",
    contact: "",
    message: "",
    consent: false,
    marketing: false,
  });
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [error, setError] = useState("");

  const update =
    (field: keyof typeof form) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const target = event.target;
      const value =
        target instanceof HTMLInputElement && target.type === "checkbox"
          ? target.checked
          : target.value;
      setForm((current) => ({ ...current, [field]: value }));
    };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.consent || status === "sending") return;
    setStatus("sending");
    setError("");
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          name: form.name,
          contact: form.contact,
          message: form.message,
          consent: form.consent,
          marketingOptIn: form.marketing,
        }),
      });
      if (!res.ok) {
        setStatus("error");
        setError(
          res.status === 429
            ? "Too many enquiries just now — please try again shortly."
            : "We couldn't send your enquiry. Please try again.",
        );
        return;
      }
      setStatus("sent");
    } catch {
      setStatus("error");
      setError("We couldn't send your enquiry. Please try again.");
    }
  };

  if (status === "sent") {
    return (
      <form className="lead-form" aria-live="polite">
        <h3>Thank you</h3>
        <p className="lead-confirm">
          {business} has your enquiry and will reply soon. You can withdraw
          consent at any time.
        </p>
      </form>
    );
  }

  return (
    <form className="lead-form" onSubmit={onSubmit}>
      <h3>Send an enquiry</h3>
      <p className="lead-purpose">
        We use your details only to respond to this enquiry. We never sell your
        data, and you can opt out at any time (POPIA).
      </p>
      <label>
        Your name
        <input value={form.name} onChange={update("name")} required />
      </label>
      <label>
        Phone or email
        <input value={form.contact} onChange={update("contact")} required />
      </label>
      <label>
        How can we help?
        <textarea rows={3} value={form.message} onChange={update("message")} />
      </label>
      <label className="lead-check">
        <input
          type="checkbox"
          checked={form.consent}
          onChange={update("consent")}
          required
        />
        <span>I consent to {business} contacting me about this enquiry.</span>
      </label>
      <label className="lead-check">
        <input
          type="checkbox"
          checked={form.marketing}
          onChange={update("marketing")}
        />
        <span>Optional: send me occasional offers and updates.</span>
      </label>
      {status === "error" ? (
        <p className="lead-error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        className="public-primary"
        type="submit"
        disabled={!form.consent || status === "sending"}
      >
        {status === "sending" ? "Sending…" : "Send enquiry"}
      </button>
    </form>
  );
}
