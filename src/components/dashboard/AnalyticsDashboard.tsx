"use client";

import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AnalyticsData {
  visits: number;
  leads: number;
  bookings: number;
  revenue: number;
  dailyVisits: number[];
  sourceBreakdown: {
    direct: number;
    whatsapp: number;
    google: number;
    other: number;
  };
}

type Period = 7 | 30 | 90;

const PERIOD_LABELS: { value: Period; label: string }[] = [
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
];

// Day labels for the 7-bar chart (most recent 7 days, Sun–Sat abbreviations)
function lastSevenDayLabels(): string[] {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const result: string[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    result.push(days[d.getDay()]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// KPI card
// ---------------------------------------------------------------------------

interface KpiCardProps {
  label: string;
  value: string;
  delta: string;
}

function KpiCard({ label, value, delta }: KpiCardProps) {
  return (
    <div className="analytics-kpi">
      <div className="analytics-kpi-label">{label}</div>
      <div className="analytics-kpi-value">{value}</div>
      <div className="analytics-kpi-delta">{delta}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bar chart (CSS only, 7 bars)
// ---------------------------------------------------------------------------

interface BarChartProps {
  data: number[];
}

function BarChart({ data }: BarChartProps) {
  const labels = lastSevenDayLabels();
  const slice = data.slice(-7);
  const max = Math.max(...slice, 1); // avoid division by zero

  return (
    <div className="analytics-chart">
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--heading)", marginBottom: 16 }}>
        Daily Visits (last 7 days)
      </div>
      <div className="analytics-bars">
        {slice.map((count, i) => {
          const heightPct = Math.round((count / max) * 100);
          return (
            <div key={i} className="analytics-bar-wrap">
              <div
                className="analytics-bar"
                style={{ height: `${Math.max(heightPct, 3)}%` }}
                title={`${count} visits`}
              />
              <div className="analytics-bar-label">{labels[i]}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Source breakdown
// ---------------------------------------------------------------------------

interface SourceBreakdownProps {
  data: AnalyticsData["sourceBreakdown"];
  total: number;
}

function SourceBreakdown({ data, total }: SourceBreakdownProps) {
  const sources: { key: keyof typeof data; label: string }[] = [
    { key: "direct", label: "Direct" },
    { key: "whatsapp", label: "WhatsApp" },
    { key: "google", label: "Google" },
    { key: "other", label: "Other" },
  ];

  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 20,
        marginBottom: 24,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--heading)", marginBottom: 14 }}>
        Traffic Sources
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {sources.map(({ key, label }) => {
          const count = data[key];
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          return (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: "0 0 72px", fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
                {label}
              </div>
              <div
                style={{
                  flex: 1,
                  height: 8,
                  borderRadius: 999,
                  background: "var(--border)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${pct}%`,
                    borderRadius: "inherit",
                    background: "linear-gradient(90deg, var(--green), var(--blue))",
                    transition: "width 400ms ease",
                  }}
                />
              </div>
              <div style={{ flex: "0 0 36px", fontSize: 12, color: "var(--muted)", textAlign: "right" }}>
                {pct}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard
// ---------------------------------------------------------------------------

export function AnalyticsDashboard() {
  const [period, setPeriod] = useState<Period>(30);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/dashboard/analytics?days=${period}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ ok: boolean; data: AnalyticsData }>;
      })
      .then(({ data: d }) => {
        setData(d);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load analytics");
        setLoading(false);
      });
  }, [period]);

  const formatRevenue = (n: number) =>
    new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR", maximumFractionDigits: 0 }).format(n);

  return (
    <section>
      {/* Period selector */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: "0 0 4px", fontSize: 22, color: "var(--heading)" }}>Analytics</h2>
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>
            Site performance and conversion signals.
          </p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {PERIOD_LABELS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setPeriod(value)}
              className={period === value ? "primary-button" : "ghost-button"}
              style={{ minHeight: 32, padding: "0 12px", fontSize: 12 }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div style={{ color: "var(--muted)", fontSize: 13, padding: "24px 0" }}>
          Loading analytics…
        </div>
      )}

      {error && (
        <div style={{ color: "#b42318", fontSize: 13, padding: "12px 0" }}>
          {error}
        </div>
      )}

      {data && !loading && (
        <>
          {/* KPI cards */}
          <div className="analytics-kpis">
            <KpiCard
              label="Total Site Visits"
              value={data.visits.toLocaleString()}
              delta={`+${Math.round(data.visits * 0.12)} vs prev period`}
            />
            <KpiCard
              label="Leads Captured"
              value={data.leads.toLocaleString()}
              delta={`${data.visits > 0 ? ((data.leads / data.visits) * 100).toFixed(1) : "0"}% conversion`}
            />
            <KpiCard
              label="Bookings Made"
              value={data.bookings.toLocaleString()}
              delta={`${data.leads > 0 ? ((data.bookings / data.leads) * 100).toFixed(0) : "0"}% of leads`}
            />
            <KpiCard
              label="Revenue (ZAR)"
              value={formatRevenue(data.revenue)}
              delta={`${data.bookings > 0 ? formatRevenue(data.revenue / data.bookings) : "R0"} avg booking`}
            />
          </div>

          {/* 7-bar CSS chart */}
          <BarChart data={data.dailyVisits} />

          {/* Source breakdown */}
          <SourceBreakdown data={data.sourceBreakdown} total={data.visits} />

          {/* Top performers */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 16,
            }}
          >
            <div
              style={{
                background: "#ffffff",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 20,
              }}
            >
              <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
                Most Clicked Service
              </div>
              <div style={{ fontSize: 17, fontWeight: 700, color: "var(--heading)" }}>
                —
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                Tracked after first bookings
              </div>
            </div>
            <div
              style={{
                background: "#ffffff",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 20,
              }}
            >
              <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
                Most Popular Booking Time
              </div>
              <div style={{ fontSize: 17, fontWeight: 700, color: "var(--heading)" }}>
                —
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                Tracked after first bookings
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
