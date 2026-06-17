import type { Business } from "@/lib/types";
import { isValidEmail } from "@/lib/format";

interface Props {
  business: Business;
  updateBusiness: (field: keyof Business, value: string) => void;
}

export function BusinessProfile({ business, updateBusiness }: Props) {
  const emailInvalid =
    business.email.trim().length > 0 && !isValidEmail(business.email);

  return (
    <section className="panel profile-panel">
      <div className="section-heading">
        <div>
          <h2>Business Profile</h2>
          <p>
            The customer answers this in plain language. The platform turns it
            into site data.
          </p>
        </div>
        <span className="quiet-tag">Step 1</span>
      </div>

      <form className="field-grid" onSubmit={(event) => event.preventDefault()}>
        <label htmlFor="bp-name">
          Business name
          <input
            id="bp-name"
            value={business.name}
            onChange={(event) => updateBusiness("name", event.target.value)}
            required
          />
        </label>
        <label htmlFor="bp-industry">
          Industry
          <input
            id="bp-industry"
            value={business.industry}
            onChange={(event) => updateBusiness("industry", event.target.value)}
          />
        </label>
        <label htmlFor="bp-location">
          City or service area
          <input
            id="bp-location"
            value={business.location}
            onChange={(event) => updateBusiness("location", event.target.value)}
          />
        </label>
        <label htmlFor="bp-whatsapp">
          WhatsApp number
          <input
            id="bp-whatsapp"
            inputMode="tel"
            value={business.whatsapp}
            onChange={(event) => updateBusiness("whatsapp", event.target.value)}
          />
        </label>
        <label htmlFor="bp-domain">
          Preferred domain
          <input
            id="bp-domain"
            value={business.domain}
            onChange={(event) => updateBusiness("domain", event.target.value)}
          />
        </label>
        <label htmlFor="bp-email">
          Business email
          <input
            id="bp-email"
            type="email"
            value={business.email}
            onChange={(event) => updateBusiness("email", event.target.value)}
            aria-invalid={emailInvalid}
            aria-describedby={emailInvalid ? "bp-email-error" : undefined}
          />
          {emailInvalid ? (
            <small id="bp-email-error" className="field-error">
              Enter a valid email address.
            </small>
          ) : null}
        </label>
      </form>

      <label className="wide-field" htmlFor="bp-offer">
        What do you offer?
        <textarea
          id="bp-offer"
          rows={3}
          value={business.offer}
          onChange={(event) => updateBusiness("offer", event.target.value)}
        />
      </label>

      <label className="wide-field" htmlFor="bp-services">
        Services or products
        <textarea
          id="bp-services"
          rows={3}
          value={business.services}
          onChange={(event) => updateBusiness("services", event.target.value)}
        />
      </label>
    </section>
  );
}
