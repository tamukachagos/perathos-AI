import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import type { Business, PublishedSite } from "@/lib/types";
import { initialsOf } from "@/lib/format";

interface Props {
  business: Business;
  latestSite: PublishedSite | null;
}

export function SitePreview({ business, latestSite }: Props) {
  const router = useRouter();

  const serviceList = business.services
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 4);

  const openLatest = () => {
    if (latestSite) router.push(`/s/${latestSite.slug}`);
  };

  return (
    <section className="panel preview-panel">
      <div className="section-heading">
        <div>
          <h2>Site Preview</h2>
          <p>Structured content becomes a fast, AI-readable website draft.</p>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Open preview"
          disabled={!latestSite}
          onClick={openLatest}
        >
          <ExternalLink size={16} />
        </button>
      </div>

      <div className="browser-frame">
        <div className="browser-bar">
          <span />
          <span />
          <span />
          <strong>{business.domain || "starter.launchdesk.africa"}</strong>
        </div>
        <div className="website-preview">
          <div className="site-nav">
            <strong>{business.name || "Your Business"}</strong>
            <span>{business.location || "South Africa"}</span>
          </div>
          <div className="site-hero">
            <div>
              <h3>{business.name || "Your Business"}</h3>
              <p>
                {business.offer ||
                  "Tell customers what you do and why they should trust you."}
              </p>
              <div className="site-actions">
                <button type="button">WhatsApp</button>
                <button type="button">Pay deposit</button>
              </div>
            </div>
            <div className="photo-tile" aria-hidden="true">
              <span>{initialsOf(business.name)}</span>
            </div>
          </div>
          <div className="service-row">
            {serviceList.map((service) => (
              <span key={service}>{service}</span>
            ))}
          </div>
          <div className="trust-row">
            <span>POPIA-ready form</span>
            <span>Secure payment links</span>
            <span>Same-day replies</span>
          </div>
        </div>
      </div>
      {latestSite ? (
        <div className="published-route">
          <span>Live route</span>
          <button type="button" onClick={openLatest}>
            /s/{latestSite.slug}
          </button>
        </div>
      ) : null}
    </section>
  );
}
