import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { PublishedSite } from "@/lib/types";
import type { ReviewRecord } from "@/integrations/reviews";
import { initialsOf, whatsappLink } from "@/lib/format";
import { buildBusinessSchema, renderJsonLd } from "@/lib/siteEngine";
import { sanitizeUrl } from "@/lib/sanitize";
import { LeadForm } from "./LeadForm";
import { ConsentBanner } from "./ConsentBanner";
import { LiveChatWidget } from "./LiveChatWidget";

// Server-rendered public customer site. Ships minimal JS (only the LeadForm
// island is client-side) and emits LocalBusiness JSON-LD server-side for SEO.
//
// SECURITY: site content is already sanitized at publish time, but every link
// is also re-validated here against the URL-scheme allowlist (https/mailto/tel/
// http) before it is rendered — so `javascript:`/`data:` payloads in an email
// or domain field can never produce a live href, even from an old snapshot.
// `showBranding` (M6): free-plan sites render a "Powered by Launch Desk" badge;
// paid plans (Growth/Pro) suppress it. Defaults to true so any caller that does
// not resolve a plan still shows branding (safe default).
// `featuredReviews`: up to 3 featured reviews to show in the "What our customers
// say" section. Resolved server-side; not shown when empty.
export function PublishedSiteView({
  site,
  showBranding = true,
  featuredReviews = [],
}: {
  site: PublishedSite;
  showBranding?: boolean;
  featuredReviews?: ReviewRecord[];
}) {
  const publishedDate = new Intl.DateTimeFormat("en-ZA", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(site.publishedAt));
  // whatsappLink only ever yields a https://wa.me/<digits> URL (digits are
  // stripped of non-numerics in format.ts), so it is safe by construction; we
  // still pass it through the allowlist for uniformity.
  const chatHref =
    sanitizeUrl(
      whatsappLink(
        site.whatsapp,
        `Hi ${site.name}, I found your website and would like to know more.`,
      ),
    ) ?? null;
  const mailHref = site.email ? sanitizeUrl(`mailto:${site.email}`) : null;
  const domainHref = site.domain ? sanitizeUrl(`https://${site.domain}`) : null;
  // S8: escape `<`/`/` so a `</script>` payload in any field cannot break out of
  // the JSON-LD script tag (see renderJsonLd). Defence in depth over publish-time
  // sanitizeText.
  const schemaJson = renderJsonLd(buildBusinessSchema(site));

  return (
    <main className="published-shell">
      {/* Local SEO: structured data so the business can surface in Google's Local Pack / Maps. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: schemaJson }}
      />

      <header className="published-header">
        <Link className="ghost-button back-button" href="/">
          <ArrowLeft size={16} />
          Launch Desk
        </Link>
        <nav aria-label="Published site sections">
          <a className="anchor-link" href="#services">
            Services
          </a>
          <a className="anchor-link" href="#trust">
            Trust
          </a>
          <a className="anchor-link" href="#contact">
            Contact
          </a>
        </nav>
      </header>

      <section className="public-hero">
        <div className="public-hero-copy">
          <span>{site.industry}</span>
          <h1>{site.name}</h1>
          <p>{site.offer}</p>
          <div className="public-actions">
            {chatHref ? (
              <a
                className="public-primary"
                href={chatHref}
                rel="noreferrer"
                target="_blank"
              >
                WhatsApp us
              </a>
            ) : null}
            {/* Book Appointment button — shown when the business has services listed */}
            {site.services && site.services.trim() ? (
              <Link
                className="public-primary"
                href={`/book/${site.slug}`}
                style={{ background: "var(--blue)" }}
              >
                Book Appointment
              </Link>
            ) : null}
            {mailHref ? (
              <a className="public-secondary" href={mailHref}>
                Send email
              </a>
            ) : null}
          </div>
        </div>
        <div className="public-visual" aria-label={`${site.name} visual identity`}>
          <div>
            <strong>{initialsOf(site.name)}</strong>
            <span>{site.location}</span>
          </div>
        </div>
      </section>

      <section className="public-section" id="services">
        <div className="public-section-heading">
          <h2>Services</h2>
          <p>
            Clear, AI-readable service pages become the foundation for Google,
            WhatsApp, and future agent answers.
          </p>
        </div>
        <div className="public-service-grid">
          {site.servicesList.map((service) => (
            <article key={service}>
              <strong>{service}</strong>
              <p>Request availability, a quote, or a deposit link through WhatsApp.</p>
            </article>
          ))}
        </div>
      </section>

      {/* Featured customer reviews — only shown when at least one review is featured */}
      {featuredReviews.length > 0 && (
        <section
          className="public-reviews"
          style={{ maxWidth: 1160, margin: "0 auto" }}
          aria-label="Customer reviews"
        >
          <div className="public-section-heading" style={{ marginBottom: 0 }}>
            <h2>What our customers say</h2>
          </div>
          <div className="public-reviews-grid">
            {featuredReviews.map((review) => (
              <div key={review.id} className="public-review-card">
                <div
                  style={{
                    color: "#f59e0b",
                    fontSize: 16,
                    marginBottom: 8,
                  }}
                  aria-label={`${review.rating} out of 5 stars`}
                >
                  {"★".repeat(review.rating)}
                  {"☆".repeat(5 - review.rating)}
                </div>
                <p
                  style={{
                    margin: "0 0 12px",
                    fontSize: 14,
                    color: "var(--text)",
                    lineHeight: 1.5,
                  }}
                >
                  {review.text.length > 80
                    ? `${review.text.slice(0, 80).trimEnd()}…`
                    : review.text}
                </p>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: "var(--heading)",
                  }}
                >
                  {review.authorName}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="public-proof-band" id="trust">
        <div>
          <strong>POPIA-ready lead form</strong>
          <span>Consent-aware inquiry capture</span>
        </div>
        <div>
          <strong>Secure payment links</strong>
          <span>No card data stored by Launch Desk</span>
        </div>
        <div>
          <strong>AI update history</strong>
          <span>Published {publishedDate}</span>
        </div>
      </section>

      <section className="public-contact" id="contact">
        <div className="public-contact-intro">
          <h2>Ready to book?</h2>
          <p>
            {site.name} serves {site.location}. Reach out and we will respond
            from {site.email}.
          </p>
          <div className="public-contact-actions">
            {/* Appointment booking CTA in the contact section */}
            {site.services && site.services.trim() ? (
              <Link
                className="public-primary"
                href={`/book/${site.slug}`}
                style={{ background: "var(--blue)" }}
              >
                Book an Appointment
              </Link>
            ) : null}
            {chatHref ? (
              <a
                className="public-primary"
                href={chatHref}
                rel="noreferrer"
                target="_blank"
              >
                Start WhatsApp chat
              </a>
            ) : null}
            {domainHref ? (
              <a
                className="public-secondary"
                href={domainHref}
                rel="noreferrer"
                target="_blank"
              >
                {site.domain}
              </a>
            ) : null}
          </div>
        </div>
        <LeadForm business={site.name} slug={site.slug} />
      </section>

      <footer className="published-footer">
        <span>
          {site.name} · {site.location}
        </span>
        <div className="published-footer-meta">
          {showBranding ? (
            <Link className="powered-badge" href="/">
              Powered by Launch Desk
            </Link>
          ) : null}
          <Link className="anchor-link" href="/privacy">
            Privacy &amp; POPIA
          </Link>
        </div>
      </footer>

      {/* POPIA: gates non-essential scripts until the visitor accepts. */}
      <ConsentBanner />

      {/* Floating live-chat widget — only rendered when a WhatsApp number exists */}
      {site.whatsapp ? (
        <LiveChatWidget
          businessName={site.name}
          whatsappNumber={site.whatsapp}
          services={site.services}
        />
      ) : null}
    </main>
  );
}

// The "site not found" state, shown when a slug has no published site.
export function MissingSiteView() {
  return (
    <main className="published-shell missing-site">
      <Link className="ghost-button back-button" href="/">
        <ArrowLeft size={16} />
        Back to Launch Desk
      </Link>
      <section className="missing-site-panel">
        <h1>Site not found</h1>
        <p>Publish the business profile again to generate a fresh site route.</p>
      </section>
    </main>
  );
}
