"use client";

import { useState } from "react";

// POPIA-by-default: a purpose statement, an un-ticked separate marketing opt-in,
// and explicit consent that must be given before the enquiry can be sent.
// (Ported verbatim from the prototype's LeadForm.)
export function LeadForm({ business }: { business: string }) {
  const [form, setForm] = useState({
    name: "",
    contact: "",
    message: "",
    consent: false,
    marketing: false,
  });
  const [sent, setSent] = useState(false);

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

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.consent) return;
    setSent(true);
  };

  if (sent) {
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
      <button className="public-primary" type="submit" disabled={!form.consent}>
        Send enquiry
      </button>
    </form>
  );
}
