"use client";

// W-Bookings: site-owner dashboard panel for managing appointment bookings.
//
// Imports ONLY React + icons + fetch — no server-only modules, no actions that
// touch node:crypto or the Prisma runtime directly.  Auth is handled server-side
// by /api/dashboard/bookings which gates on requireTenant().

import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar, Check, CheckCheck, ClipboardCopy, Loader2, X, XCircle } from "lucide-react";

// ---- Types ------------------------------------------------------------------

type BookingStatus = "pending" | "confirmed" | "completed" | "cancelled";

interface Booking {
  id: string;
  siteSlug: string;
  customerName: string;
  customerPhone: string;
  service: string;
  date: string;   // "YYYY-MM-DD"
  time: string;   // "HH:MM"
  status: BookingStatus;
  whatsappSent: boolean;
  createdAt: string;
}

// ---- Helpers ----------------------------------------------------------------

function friendlyDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-ZA", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(y, m - 1, d));
}

function statusStyle(status: BookingStatus): React.CSSProperties {
  switch (status) {
    case "pending":    return { color: "#664608", background: "#fff4d7" };
    case "confirmed":  return { color: "#0f5132", background: "#e7f5ec" };
    case "completed":  return { color: "#32465d", background: "#e9f1f8" };
    case "cancelled":  return { color: "#b42318", background: "#fdecea" };
  }
}

function StatusBadge({ status }: { status: BookingStatus }) {
  return (
    <span
      style={{
        ...statusStyle(status),
        display: "inline-block",
        padding: "3px 9px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 800,
        textTransform: "capitalize",
        letterSpacing: "0.01em",
      }}
    >
      {status}
    </span>
  );
}

// ---- Calendar week view ------------------------------------------------------

// Builds Mon-Sat for the week that contains `anchor` (a "YYYY-MM-DD" string).
function weekDays(anchor: string): string[] {
  const [y, m, d] = anchor.split("-").map(Number);
  const base = new Date(y, m - 1, d);
  // Monday = 1, shift so Monday is day 0
  const dayOfWeek = base.getDay(); // 0=Sun … 6=Sat
  const monday = new Date(base);
  monday.setDate(base.getDate() - ((dayOfWeek + 6) % 7));
  return Array.from({ length: 6 }, (_, i) => {
    const dd = new Date(monday);
    dd.setDate(monday.getDate() + i);
    const yy = dd.getFullYear();
    const mm = String(dd.getMonth() + 1).padStart(2, "0");
    const ddd = String(dd.getDate()).padStart(2, "0");
    return `${yy}-${mm}-${ddd}`;
  });
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const SLOT_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16];
const STATUS_COLORS: Record<BookingStatus, string> = {
  pending:   "#ffc457",
  confirmed: "#0f7a4f",
  completed: "#123a6f",
  cancelled: "#aebccd",
};

interface WeekCalendarProps {
  bookings: Booking[];
  anchor: string;
  onAnchorChange: (d: string) => void;
}

function WeekCalendar({ bookings, anchor, onAnchorChange }: WeekCalendarProps) {
  const days = weekDays(anchor);

  function prevWeek() {
    const [y, m, d] = anchor.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() - 7);
    onAnchorChange(
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`,
    );
  }

  function nextWeek() {
    const [y, m, d] = anchor.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + 7);
    onAnchorChange(
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`,
    );
  }

  // Index bookings by date+time for O(1) lookup
  const index: Record<string, Booking[]> = {};
  for (const b of bookings) {
    const key = `${b.date}|${b.time}`;
    if (!index[key]) index[key] = [];
    index[key].push(b);
  }

  const COL_W = 100; // px per day column
  const ROW_H = 48;  // px per hour row

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Week navigation */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 10,
        }}
      >
        <button
          type="button"
          className="ghost-button"
          style={{ minHeight: 30, padding: "0 10px", fontSize: 12 }}
          onClick={prevWeek}
        >
          &#8592; Prev
        </button>
        <span style={{ fontWeight: 700, color: "var(--heading)", fontSize: 13 }}>
          {friendlyDate(days[0])} – {friendlyDate(days[5])}
        </span>
        <button
          type="button"
          className="ghost-button"
          style={{ minHeight: 30, padding: "0 10px", fontSize: 12 }}
          onClick={nextWeek}
        >
          Next &#8594;
        </button>
        <button
          type="button"
          className="ghost-button"
          style={{ minHeight: 30, padding: "0 10px", fontSize: 12 }}
          onClick={() => onAnchorChange(todayIso())}
        >
          Today
        </button>
      </div>

      {/* Calendar grid */}
      <div style={{ overflowX: "auto" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `48px repeat(6, ${COL_W}px)`,
            fontSize: 11,
            borderTop: "1px solid var(--border)",
            borderLeft: "1px solid var(--border)",
            minWidth: 648,
          }}
        >
          {/* Header row */}
          <div
            style={{
              padding: "6px 4px",
              borderRight: "1px solid var(--border)",
              borderBottom: "1px solid var(--border)",
              background: "#f8fafc",
            }}
          />
          {days.map((day) => {
            const isToday = day === todayIso();
            return (
              <div
                key={day}
                style={{
                  padding: "6px 4px",
                  fontWeight: 800,
                  color: isToday ? "var(--blue)" : "var(--heading)",
                  background: isToday ? "var(--soft-blue)" : "#f8fafc",
                  borderRight: "1px solid var(--border)",
                  borderBottom: "1px solid var(--border)",
                  textAlign: "center",
                }}
              >
                {new Date(day + "T12:00:00").toLocaleDateString("en-ZA", {
                  weekday: "short",
                  day: "numeric",
                })}
              </div>
            );
          })}

          {/* Hour rows */}
          {SLOT_HOURS.map((hour) => {
            const slot = `${String(hour).padStart(2, "0")}:00`;
            return [
              <div
                key={`hour-${hour}`}
                style={{
                  height: ROW_H,
                  padding: "4px",
                  borderRight: "1px solid var(--border)",
                  borderBottom: "1px solid var(--border)",
                  color: "var(--muted)",
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "flex-end",
                  fontSize: 10,
                }}
              >
                {slot}
              </div>,
              ...days.map((day) => {
                const cellBookings = index[`${day}|${slot}`] ?? [];
                return (
                  <div
                    key={`${day}-${hour}`}
                    style={{
                      height: ROW_H,
                      borderRight: "1px solid var(--border)",
                      borderBottom: "1px solid var(--border)",
                      padding: 2,
                      background: day === todayIso() ? "#f5f9ff" : undefined,
                    }}
                  >
                    {cellBookings.map((b) => (
                      <div
                        key={b.id}
                        title={`${b.customerName} — ${b.service} (${b.status})`}
                        style={{
                          height: "100%",
                          borderRadius: 4,
                          background: STATUS_COLORS[b.status as BookingStatus] ?? "#ccc",
                          color: b.status === "pending" ? "#664608" : "#fff",
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 4px",
                          overflow: "hidden",
                          whiteSpace: "nowrap",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {b.customerName}
                      </div>
                    ))}
                  </div>
                );
              }),
            ];
          })}
        </div>
      </div>
    </div>
  );
}

// ---- Main component ----------------------------------------------------------

type StatusFilter = "all" | BookingStatus;

interface Props {
  /** The slug of the tenant's primary published site (for the booking link). */
  slug: string;
}

export function BookingsDashboard({ slug }: Props) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [calendarAnchor, setCalendarAnchor] = useState(todayIso());
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<"list" | "calendar">("list");

  const bookingLink = `https://app.perathos.com/book/${slug}`;

  const load = useCallback(() => {
    setLoading(true);
    setFetchError("");
    fetch("/api/dashboard/bookings")
      .then((r) => r.json())
      .then((data: { bookings?: Booking[]; error?: string }) => {
        if (data.bookings) setBookings(data.bookings);
        else setFetchError(data.error ?? "Failed to load bookings.");
      })
      .catch(() => setFetchError("Network error loading bookings."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function updateStatus(id: string, status: BookingStatus) {
    setActionError("");
    setActionLoading(id);
    try {
      const res = await fetch("/api/dashboard/bookings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setActionError(data.error ?? "Could not update booking.");
      } else {
        // Optimistic update
        setBookings((prev) =>
          prev.map((b) => (b.id === id ? { ...b, status } : b)),
        );
      }
    } catch {
      setActionError("Network error — please try again.");
    } finally {
      setActionLoading(null);
    }
  }

  function copyLink() {
    void navigator.clipboard.writeText(bookingLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const filtered = useMemo(
    () =>
      statusFilter === "all"
        ? bookings
        : bookings.filter((b) => b.status === statusFilter),
    [bookings, statusFilter],
  );

  const FILTERS: StatusFilter[] = ["all", "pending", "confirmed", "completed", "cancelled"];

  return (
    <section className="panel" style={{ padding: 20 }}>
      {/* Header */}
      <div className="section-heading">
        <div>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Calendar size={18} />
            Appointments
          </h2>
          <p>Manage bookings from your customers.</p>
        </div>
        {/* Booking link copy */}
        <button
          type="button"
          className="ghost-button"
          style={{ alignSelf: "flex-start", whiteSpace: "nowrap", fontSize: 12 }}
          onClick={copyLink}
        >
          <ClipboardCopy size={13} />
          {copied ? "Copied!" : "Copy booking link"}
        </button>
      </div>

      {/* Booking link display */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 16,
          padding: "8px 12px",
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "#f8fafc",
          fontSize: 12,
        }}
      >
        <span style={{ color: "var(--muted)", fontWeight: 700 }}>Booking link:</span>
        <a
          href={bookingLink}
          target="_blank"
          rel="noreferrer"
          style={{ color: "var(--blue)", fontWeight: 700, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {bookingLink}
        </a>
      </div>

      {/* View toggle */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          className={view === "list" ? "primary-button" : "ghost-button"}
          style={{ minHeight: 30, padding: "0 12px", fontSize: 12 }}
          onClick={() => setView("list")}
        >
          List
        </button>
        <button
          type="button"
          className={view === "calendar" ? "primary-button" : "ghost-button"}
          style={{ minHeight: 30, padding: "0 12px", fontSize: 12 }}
          onClick={() => setView("calendar")}
        >
          Week view
        </button>
      </div>

      {/* Status filter tabs */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          marginBottom: 16,
        }}
      >
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setStatusFilter(f)}
            style={{
              minHeight: 28,
              padding: "0 10px",
              border: "1px solid",
              borderColor: statusFilter === f ? "var(--blue)" : "var(--border)",
              borderRadius: 999,
              background: statusFilter === f ? "var(--soft-blue)" : "#fff",
              color: statusFilter === f ? "var(--blue)" : "var(--muted)",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {f === "all"
              ? `All (${bookings.length})`
              : `${f} (${bookings.filter((b) => b.status === f).length})`}
          </button>
        ))}
      </div>

      {/* Errors */}
      {fetchError && (
        <p style={{ color: "#b42318", fontSize: 12.5, fontWeight: 700, margin: "0 0 12px" }}>
          {fetchError}
        </p>
      )}
      {actionError && (
        <p style={{ color: "#b42318", fontSize: 12.5, fontWeight: 700, margin: "0 0 12px" }}>
          {actionError}
        </p>
      )}

      {/* Loading spinner */}
      {loading && (
        <div style={{ display: "flex", justifyContent: "center", padding: 32 }}>
          <Loader2 size={22} className="spin" style={{ color: "var(--muted)" }} />
        </div>
      )}

      {/* Calendar week view */}
      {!loading && view === "calendar" && (
        <WeekCalendar
          bookings={bookings}
          anchor={calendarAnchor}
          onAnchorChange={setCalendarAnchor}
        />
      )}

      {/* List view */}
      {!loading && view === "list" && (
        <>
          {filtered.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: 13 }}>
              {statusFilter === "all"
                ? "No bookings yet. Share your booking link to get started."
                : `No ${statusFilter} bookings.`}
            </p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {filtered.map((b) => (
                <article
                  key={b.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 12,
                    alignItems: "center",
                    padding: "12px 14px",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    background: "#ffffff",
                  }}
                >
                  {/* Left: info */}
                  <div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        flexWrap: "wrap",
                        marginBottom: 4,
                      }}
                    >
                      <strong style={{ color: "var(--heading)", fontSize: 14 }}>
                        {b.customerName}
                      </strong>
                      <StatusBadge status={b.status as BookingStatus} />
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "4px 14px",
                        color: "var(--muted)",
                        fontSize: 12,
                      }}
                    >
                      <span>{b.customerPhone}</span>
                      <span>{b.service}</span>
                      <span>
                        {friendlyDate(b.date)} at {b.time}
                      </span>
                    </div>
                  </div>

                  {/* Right: actions */}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {b.status === "pending" && (
                      <button
                        type="button"
                        className="ghost-button"
                        style={{ minHeight: 28, padding: "0 10px", fontSize: 11, color: "var(--green)" }}
                        disabled={actionLoading === b.id}
                        onClick={() => updateStatus(b.id, "confirmed")}
                        title="Confirm booking"
                      >
                        {actionLoading === b.id ? (
                          <Loader2 size={12} className="spin" />
                        ) : (
                          <Check size={12} />
                        )}
                        Confirm
                      </button>
                    )}
                    {(b.status === "pending" || b.status === "confirmed") && (
                      <button
                        type="button"
                        className="ghost-button"
                        style={{ minHeight: 28, padding: "0 10px", fontSize: 11, color: "var(--blue)" }}
                        disabled={actionLoading === b.id}
                        onClick={() => updateStatus(b.id, "completed")}
                        title="Mark as completed"
                      >
                        {actionLoading === b.id ? (
                          <Loader2 size={12} className="spin" />
                        ) : (
                          <CheckCheck size={12} />
                        )}
                        Done
                      </button>
                    )}
                    {b.status !== "cancelled" && b.status !== "completed" && (
                      <button
                        type="button"
                        className="ghost-button"
                        style={{ minHeight: 28, padding: "0 10px", fontSize: 11, color: "#b42318" }}
                        disabled={actionLoading === b.id}
                        onClick={() => updateStatus(b.id, "cancelled")}
                        title="Cancel booking"
                      >
                        {actionLoading === b.id ? (
                          <Loader2 size={12} className="spin" />
                        ) : (
                          <XCircle size={12} />
                        )}
                        Cancel
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
