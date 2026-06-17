// POPIA configuration + helpers (M5).
//
// Everything here has a safe MOCK default so the app builds and runs with no
// env: the Information Officer contact, retention window, and processing
// purpose are configurable via env but fall back to documented defaults. These
// values feed the auto-generated /privacy page, the consent banner copy, and
// the retention purge Cron.

/** Retention window for captured leads, in months. Drives the purge Cron. */
export const RETENTION_MONTHS = (() => {
  const raw = Number(process.env.LAUNCH_DESK_RETENTION_MONTHS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 12;
})();

/** The single processing purpose leads are captured for. */
export const PROCESSING_PURPOSE = "Respond to this enquiry";

/** Configurable Information Officer contact, surfaced on /privacy. */
export interface InformationOfficer {
  name: string;
  email: string;
  /** The legal entity / responsible party the IO acts for. */
  responsibleParty: string;
}

export function informationOfficer(): InformationOfficer {
  return {
    name: process.env.LAUNCH_DESK_IO_NAME?.trim() || "Information Officer",
    email:
      process.env.LAUNCH_DESK_IO_EMAIL?.trim() || "privacy@launchdesk.co.za",
    responsibleParty:
      process.env.LAUNCH_DESK_IO_PARTY?.trim() || "Launch Desk",
  };
}

/** Compute a retention/expiry date `RETENTION_MONTHS` from `from`. */
export function retentionUntil(from: Date = new Date()): Date {
  const until = new Date(from);
  until.setMonth(until.getMonth() + RETENTION_MONTHS);
  return until;
}
