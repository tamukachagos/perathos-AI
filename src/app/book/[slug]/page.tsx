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

// ── Inline translation map ────────────────────────────────────────────────────
const T: Record<string, Record<string, string>> = {
  en: { title: "Book an appointment", select_service: "Select a service", select_date: "Choose a date", select_time: "Choose a time", your_name: "Your name", your_phone: "Phone / WhatsApp", submit: "Confirm booking", success: "Booking confirmed! You'll receive a WhatsApp confirmation shortly.", consent: "By booking you consent to us contacting you about your appointment." },
  es: { title: "Reservar una cita", select_service: "Seleccionar servicio", select_date: "Elegir fecha", select_time: "Elegir hora", your_name: "Tu nombre", your_phone: "Teléfono / WhatsApp", submit: "Confirmar reserva", success: "¡Reserva confirmada! Recibirás una confirmación por WhatsApp.", consent: "Al reservar aceptas que te contactemos sobre tu cita." },
  pt: { title: "Agendar uma consulta", select_service: "Selecionar serviço", select_date: "Escolher data", select_time: "Escolher horário", your_name: "Seu nome", your_phone: "Telefone / WhatsApp", submit: "Confirmar agendamento", success: "Agendamento confirmado! Você receberá uma confirmação pelo WhatsApp.", consent: "Ao agendar você concorda que entremos em contato sobre sua consulta." },
  fr: { title: "Prendre rendez-vous", select_service: "Sélectionner un service", select_date: "Choisir une date", select_time: "Choisir une heure", your_name: "Votre nom", your_phone: "Téléphone / WhatsApp", submit: "Confirmer le rendez-vous", success: "Rendez-vous confirmé ! Vous recevrez une confirmation par WhatsApp.", consent: "En réservant vous acceptez d'être contacté au sujet de votre rendez-vous." },
  de: { title: "Termin buchen", select_service: "Service wählen", select_date: "Datum wählen", select_time: "Uhrzeit wählen", your_name: "Ihr Name", your_phone: "Telefon / WhatsApp", submit: "Termin bestätigen", success: "Termin bestätigt! Sie erhalten eine WhatsApp-Bestätigung.", consent: "Mit der Buchung stimmen Sie zu, bezüglich Ihres Termins kontaktiert zu werden." },
  ar: { title: "احجز موعدًا", select_service: "اختر الخدمة", select_date: "اختر التاريخ", select_time: "اختر الوقت", your_name: "اسمك", your_phone: "الهاتف / واتساب", submit: "تأكيد الحجز", success: "تم تأكيد الحجز! ستتلقى تأكيدًا عبر واتساب.", consent: "بالحجز توافق على التواصل معك بشأن موعدك." },
  zh: { title: "预约服务", select_service: "选择服务", select_date: "选择日期", select_time: "选择时间", your_name: "您的姓名", your_phone: "电话 / WhatsApp", submit: "确认预约", success: "预约已确认！您将收到WhatsApp确认消息。", consent: "预约即表示您同意我们就您的预约与您联系。" },
  ja: { title: "予約する", select_service: "サービスを選択", select_date: "日付を選択", select_time: "時間を選択", your_name: "お名前", your_phone: "電話 / WhatsApp", submit: "予約を確認", success: "予約が確定しました！WhatsAppで確認メッセージをお送りします。", consent: "予約することで、予約に関する連絡を受けることに同意します。" },
  ko: { title: "예약하기", select_service: "서비스 선택", select_date: "날짜 선택", select_time: "시간 선택", your_name: "성함", your_phone: "전화 / WhatsApp", submit: "예약 확인", success: "예약이 확정되었습니다! WhatsApp으로 확인 메시지를 받으실 거예요.", consent: "예약하면 예약 관련 연락을 받는 것에 동의하게 됩니다." },
  hi: { title: "अपॉइंटमेंट बुक करें", select_service: "सेवा चुनें", select_date: "तारीख चुनें", select_time: "समय चुनें", your_name: "आपका नाम", your_phone: "फ़ोन / WhatsApp", submit: "बुकिंग की पुष्टि करें", success: "बुकिंग की पुष्टि हो गई! आपको WhatsApp पर पुष्टि मिलेगी।", consent: "बुकिंग करके आप अपनी अपॉइंटमेंट के बारे में संपर्क किए जाने के लिए सहमत हैं।" },
};

function t(locale: string, key: string): string {
  return (T[locale] ?? T["en"])[key] ?? T["en"][key] ?? key;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

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

  // Locale detection
  const [locale, setLocale] = useState("en");

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

  // Detect browser locale on mount
  useEffect(() => {
    const lang = navigator.language ?? "en";
    // Keep "pt-BR" as "pt" (only map the base language code)
    const base = lang.includes("-") ? lang.split("-")[0] : lang;
    const supported = Object.keys(T);
    setLocale(supported.includes(base) ? base : "en");
  }, []);

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

  const isRtl = locale === "ar";

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
        <div className="booking-card" style={{ textAlign: "center" }} dir={isRtl ? "rtl" : undefined}>
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
          <h2 style={{ color: "var(--heading)", marginTop: 0 }}>{t(locale, "success")}</h2>
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
      <div className="booking-card" dir={isRtl ? "rtl" : undefined}>
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
            {t(locale, "title")}
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
                {t(locale, "select_service")}
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
              {t(locale, "select_date")}
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
                {t(locale, "select_time")}
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
            placeholder={t(locale, "your_name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            required
            autoComplete="name"
          />
          <input
            className="booking-field"
            type="tel"
            placeholder={t(locale, "your_phone")}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={30}
            required
            autoComplete="tel"
          />

          {/* Consent notice */}
          <p
            style={{
              margin: "4px 0 16px",
              color: "var(--muted)",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            {t(locale, "consent")}
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
            {submitting ? "Booking…" : t(locale, "submit")}
          </button>
        </form>
      </div>
    </div>
  );
}
