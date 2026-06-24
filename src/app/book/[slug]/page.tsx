// Public appointment booking page for a business site.
// Customers navigate to /book/[slug] to book a time with the business.
// Resolves the PublishedSite from the same repo used by /s/[slug].

"use client";

import { useEffect, useState } from "react";
import type { PublishedSite } from "@/lib/types";

interface PageProps {
  params: Promise<{ slug: string }>;
}

// Time slots offered every booking day.
const SLOTS = [
  "08:00", "09:00", "10:00", "11:00", "12:00",
  "13:00", "14:00", "15:00", "16:00",
];

// Build the next 14 calendar dates (today through today+13), excluding Sundays.
function buildDateOptions(): string[] {
  const dates: string[] = [];
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  while (dates.length < 14) {
    if (d.getDay() !== 0) {
      // "YYYY-MM-DD" in local time
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      dates.push(`${y}-${m}-${day}`);
    }
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

function friendlyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-ZA", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(y, m - 1, d));
}

export default function BookingPage({ params }: PageProps) {
  const [slug, setSlug] = useState("");
  const [site, setSite] = useState<PublishedSite | null>(null);
  const [loading, setLoading] = useState(true);
  const [siteError, setSiteError] = useState(false);

  // Form state
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [service, setService] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [takenSlots, setTakenSlots] = useState<string[]>([]);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const dates = buildDateOptions();

  // Resolve params (Next 15 async params)
  useEffect(() => {
    params.then(({ slug: s }) => setSlug(s));
  }, [params]);

  // Fetch the site info so we know the business name and services list
  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    fetch(`/api/book/${slug}?meta=1`)
      .then((r) => r.json())
      .then((data: { site?: PublishedSite; error?: string }) => {
        if (data.site) {
          setSite(data.site);
          // Default service to first in list
          const services = (data.site.services ?? "")
            .split(",")
            .map((s: string) => s.trim())
            .filter(Boolean);
          if (services.length) setService(services[0]);
        } else {
          setSiteError(true);
        }
      })
      .catch(() => setSiteError(true))
      .finally(() => setLoading(false));
  }, [slug]);

  // Fetch taken slots whenever date changes
  useEffect(() => {
    if (!slug || !date) return;
    fetch(`/api/book/${slug}?date=${date}`)
      .then((r) => r.json())
      .then((data: { takenSlots?: string[] }) => {
        setTakenSlots(data.takenSlots ?? []);
        // Deselect current time if it is now taken
        if (time && data.takenSlots?.includes(time)) setTime("");
      })
      .catch(() => setTakenSlots([]));
  }, [slug, date, time]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!date || !time || !service || !name.trim() || !phone.trim()) {
      setError("Please fill in all fields and select a date and time.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/book/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, service, date, time }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Something went wrong — please try again.");
      } else {
        setSuccess(true);
      }
    } catch {
      setError("Network error — please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="booking-page" style={{ display: "grid", placeItems: "center" }}>
        <p style={{ color: "var(--muted)" }}>Loading...</p>
      </div>
    );
  }

  if (siteError || !site) {
    return (
      <div className="booking-page">
        <div className="booking-card" style={{ textAlign: "center" }}>
          <h1 style={{ color: "var(--heading)", marginTop: 0 }}>Business not found</h1>
          <p style={{ color: "var(--muted)" }}>
            This booking link does not match a published business.
          </p>
        </div>
      </div>
    );
  }

  const services = site.services
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (success) {
    return (
      <div className="booking-page" style={{ display: "grid", placeItems: "center" }}>
        <div className="booking-card" style={{ textAlign: "center" }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "var(--green)",
              display: "grid",
              placeItems: "center",
              margin: "0 auto 20px",
              color: "#fff",
              fontSize: 26,
            }}
          >
            &#10003;
          </div>
          <h2 style={{ color: "var(--heading)", marginTop: 0 }}>Booking confirmed!</h2>
          <p style={{ color: "var(--muted)" }}>
            You&apos;ll receive a WhatsApp confirmation shortly.
          </p>
          <p style={{ color: "var(--muted)", fontSize: 13 }}>
            <strong>{service}</strong> on {friendlyDate(date)} at {time} with {site.name}.
          </p>
          <a
            href={`/s/${slug}`}
            style={{
              display: "inline-block",
              marginTop: 16,
              color: "var(--blue)",
              fontWeight: 700,
              fontSize: 13,
              textDecoration: "none",
            }}
          >
            Back to {site.name}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="booking-page">
      <div className="booking-card">
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <a
            href={`/s/${slug}`}
            style={{
              color: "var(--muted)",
              fontSize: 12,
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            &larr; {site.name}
          </a>
          <h1
            style={{
              margin: "8px 0 4px",
              color: "var(--heading)",
              fontSize: 24,
              fontWeight: 780,
            }}
          >
            Book an Appointment
          </h1>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
            {site.name} &middot; {site.location}
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          {/* Service selector */}
          {services.length > 1 && (
            <div style={{ marginBottom: 16 }}>
              <label
                style={{
                  display: "block",
                  marginBottom: 6,
                  color: "var(--muted)",
                  fontSize: 12,
                  fontWeight: 720,
                }}
              >
                Service
              </label>
              <select
                className="booking-field"
                value={service}
                onChange={(e) => setService(e.target.value)}
                required
                style={{ appearance: "auto" }}
              >
                {services.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Date picker */}
          <div style={{ marginBottom: 16 }}>
            <label
              style={{
                display: "block",
                marginBottom: 6,
                color: "var(--muted)",
                fontSize: 12,
                fontWeight: 720,
              }}
            >
              Date (next 14 days, Mon–Sat)
            </label>
            <select
              className="booking-field"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setTime("");
              }}
              required
              style={{ appearance: "auto" }}
            >
              <option value="">Select a date…</option>
              {dates.map((d) => (
                <option key={d} value={d}>
                  {friendlyDate(d)}
                </option>
              ))}
            </select>
          </div>

          {/* Time slots */}
          {date && (
            <div style={{ marginBottom: 16 }}>
              <label
                style={{
                  display: "block",
                  marginBottom: 8,
                  color: "var(--muted)",
                  fontSize: 12,
                  fontWeight: 720,
                }}
              >
                Time slot
              </label>
              <div className="booking-grid">
                {SLOTS.map((slot) => {
                  const taken = takenSlots.includes(slot);
                  const selected = time === slot;
                  return (
                    <button
                      key={slot}
                      type="button"
                      disabled={taken}
                      onClick={() => !taken && setTime(slot)}
                      className={[
                        "booking-slot",
                        selected ? "selected" : "",
                        taken ? "taken" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {slot}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Customer fields */}
          <input
            className="booking-field"
            type="text"
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            required
            autoComplete="name"
          />
          <input
            className="booking-field"
            type="tel"
            placeholder="WhatsApp number (e.g. 0821234567)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={30}
            required
            autoComplete="tel"
          />

          {/* POPIA consent notice */}
          <p
            style={{
              margin: "4px 0 16px",
              color: "var(--muted)",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            By booking you consent to us contacting you about your appointment.
            Your information is processed in accordance with POPIA.
          </p>

          {error && (
            <p
              style={{
                margin: "0 0 12px",
                color: "#b42318",
                fontSize: 12.5,
                fontWeight: 700,
              }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            className="booking-submit"
            disabled={submitting || !date || !time}
          >
            {submitting ? "Booking…" : "Confirm booking"}
          </button>
        </form>
      </div>
    </div>
  );
}
