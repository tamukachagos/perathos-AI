import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  informationOfficer,
  PROCESSING_PURPOSE,
  RETENTION_MONTHS,
} from "@/lib/popia";

// Auto-generated POPIA privacy policy. Static (no DB, no session) so it builds
// and renders with no env; the Information Officer contact + retention window
// come from config (src/lib/popia.ts) and fall back to safe defaults in mock.
export const metadata: Metadata = {
  title: "Privacy policy — Launch Desk",
  description:
    "How Launch Desk and the businesses it hosts process personal information under POPIA.",
};

export default function PrivacyPage() {
  const io = informationOfficer();
  return (
    <main className="published-shell privacy-page">
      <header className="published-header">
        <Link className="ghost-button back-button" href="/">
          <ArrowLeft size={16} />
          Launch Desk
        </Link>
      </header>

      <article className="privacy-body">
        <h1>Privacy policy</h1>
        <p>
          This notice explains how <strong>{io.responsibleParty}</strong> and the
          businesses published on Launch Desk process your personal information
          under South Africa&rsquo;s Protection of Personal Information Act
          (POPIA).
        </p>

        <h2>What we collect and why</h2>
        <p>
          When you send an enquiry through a published site we collect the
          details you provide (your name, your contact details, and your
          message). We use them for one purpose only:{" "}
          <strong>{PROCESSING_PURPOSE.toLowerCase()}</strong>. We do not sell your
          information, and we never use it for marketing unless you separately and
          explicitly opt in.
        </p>

        <h2>Consent</h2>
        <p>
          We only store an enquiry after you give explicit consent on the form.
          The date and time of your consent are recorded with the enquiry. You may
          withdraw consent at any time by contacting the Information Officer below.
        </p>

        <h2>How long we keep it (retention)</h2>
        <p>
          Enquiries are retained for{" "}
          <strong>{RETENTION_MONTHS} months</strong> and are then automatically
          and permanently deleted by a scheduled retention process, unless a
          longer period is required by law or you re-consent.
        </p>

        <h2>Your rights (access, correction &amp; erasure)</h2>
        <p>
          Under POPIA you may request a copy of the information we hold about you,
          ask us to correct it, or ask us to delete it (a Data Subject Access
          Request, or DSAR). To exercise any of these rights, email the
          Information Officer with the contact detail you used on the form. We will
          export your records and, where you request erasure, permanently delete
          them and log that the deletion took place.
        </p>

        <h2>Information Officer</h2>
        <p>
          The responsible party&rsquo;s Information Officer handles all privacy
          requests:
        </p>
        <ul>
          <li>
            <strong>{io.name}</strong>
          </li>
          <li>
            <a href={`mailto:${io.email}`}>{io.email}</a>
          </li>
          <li>On behalf of {io.responsibleParty}</li>
        </ul>

        <h2>Cookies &amp; non-essential scripts</h2>
        <p>
          Published sites load only what is needed to show the page until you
          accept the consent banner. Non-essential scripts (for example
          analytics) run only after you accept.
        </p>
      </article>
    </main>
  );
}
