import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { PublishedSite } from "@/lib/types";
import { initialsOf, whatsappLink } from "@/lib/format";
import { buildBusinessSchema } from "@/lib/siteEngine";
import { sanitizeUrl } from "@/lib/sanitize";
import { LeadForm } from "./LeadForm";

// Server-rendered public customer site. Ships minimal JS (only the LeadForm
// island is client-side) and emits LocalBusiness JSON-LD server-side for SEO.
//
// SECURITY: site content is already sanitized at publish time, but every link
// is also re-validated here against the URL-scheme allowlist (https/mailto/tel/
// http) before it is rendered — so `javascript:`/`data:` payloads in an email
// or domain field can never produce a live href, even from an old snapshot.
export function PublishedSiteView({ site }: { site: PublishedSite }) {
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
  const schema = buildBusinessSchema(site);

  return (
    <main className="published-shell">
      {/* Local SEO: structured data so the business can surface in Google's Local Pack / Maps. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
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
