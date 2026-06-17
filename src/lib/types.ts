// Shared contracts for Launch Desk. Downstream milestones IMPORT these — they do
// not edit them. (Sipho lands these first per the roadmap.)
//
// Keep this file free of runtime/UI dependencies so both the client readiness
// plane and the server action plane can depend on it.

/**
 * The plain-language business profile the customer fills in. This is the draft
 * the dashboard edits; M1 will persist it to Postgres instead of localStorage.
 */
export interface Business {
  name: string;
  industry: string;
  location: string;
  whatsapp: string;
  domain: string;
  email: string;
  tone: string;
  offer: string;
  services: string;
}

/** Readiness vocabulary shared across the platform. */
export type AdapterStatus = "ready" | "review" | "pending";

/** A capability's evaluated readiness: pure, secret-free, client-safe. */
export interface AdapterReadiness {
  status: AdapterStatus;
  detail: string;
}

/**
 * The launch-record entry persisted with a published site. `status` collapses
 * REVIEW into the explicit "approval-required" marker the public record uses.
 */
export interface LaunchRecordEntry {
  id: string;
  title: string;
  provider: string;
  status: AdapterStatus | "approval-required";
}

/**
 * A site that has been published from a Business draft. In M0 this lives in the
 * client store (localStorage); M2 makes it a server-rendered, versioned record.
 */
export interface PublishedSite extends Business {
  slug: string;
  publishedAt: string;
  servicesList: string[];
  launchRecord: LaunchRecordEntry[];
}

/** A keyed collection of published sites, addressed by slug. */
export type PublishedSites = Record<string, PublishedSite>;

/** The `LocalBusiness` JSON-LD shape emitted server-side on every public site. */
export interface BusinessSchema {
  "@context": "https://schema.org";
  "@type": "LocalBusiness";
  name: string;
  description: string;
  areaServed: string;
  address: {
    "@type": "PostalAddress";
    addressLocality: string;
    addressCountry: "ZA";
  };
  email?: string;
  url?: string;
  makesOffer?: Array<{
    "@type": "Offer";
    itemOffered: { "@type": "Service"; name: string };
  }>;
}

/** Mode that selects how an adapter's action plane behaves. */
export type AdapterMode = "mock" | "sandbox" | "live";
