import { initialBusiness } from './platformData'
import { launchAdapters, STATUS } from './adapters'
import { slugify } from './format'

const DRAFT_KEY = 'launchdesk:draft:v1'
const SITES_KEY = 'launchdesk:sites:v1'

function readJson(key, fallback) {
  if (typeof window === 'undefined') return fallback

  try {
    const stored = window.localStorage.getItem(key)
    return stored ? JSON.parse(stored) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // localStorage can fail in private browsing or locked-down environments.
  }
}

export function readStoredDraft() {
  return { ...initialBusiness, ...readJson(DRAFT_KEY, {}) }
}

export function writeStoredDraft(business) {
  writeJson(DRAFT_KEY, business)
}

export function readPublishedSites() {
  return readJson(SITES_KEY, {})
}

export function writePublishedSites(sites) {
  writeJson(SITES_KEY, sites)
}

export { slugify }

// Only treat hashes that start with "#/" as app routes. Bare fragments like
// "#services" (in-page anchors on a published site) must NOT be parsed as routes,
// otherwise clicking them navigates the visitor away from the site.
export function getHashRoute() {
  if (typeof window === 'undefined') return { type: 'dashboard' }

  const hash = window.location.hash
  if (!hash.startsWith('#/')) return { type: 'dashboard' }

  const [view, slug] = hash.slice(2).split('/')

  if (view === 'site' && slug) {
    return { type: 'site', slug }
  }

  return { type: 'dashboard' }
}

// Guarantee a unique slug so publishing a second "Joe's Shop" never silently
// overwrites the first one.
export function uniqueSlug(baseName, takenSlugs = []) {
  const base = slugify(baseName)
  const taken = new Set(takenSlugs)
  if (!taken.has(base)) return base

  let suffix = 2
  while (taken.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

export function buildPublishedSite(business, existingSites = {}) {
  const ownSlug = slugify(business.name)
  // Re-publishing the same business keeps its slug; a genuinely new name that
  // collides with an existing site gets a numbered suffix.
  const slug = existingSites[ownSlug] ? ownSlug : uniqueSlug(business.name, Object.keys(existingSites))
  const publishedAt = new Date().toISOString()
  const services = business.services
    .split(',')
    .map((service) => service.trim())
    .filter(Boolean)

  return {
    ...business,
    slug,
    publishedAt,
    servicesList: services.length > 0 ? services : ['Consultation', 'Bookings', 'Customer support'],
    launchRecord: launchAdapters.map((adapter) => {
      const { status } = adapter.evaluate(business)
      return {
        id: adapter.key,
        title: adapter.title,
        provider: adapter.provider,
        status: status === STATUS.REVIEW ? 'approval-required' : status,
      }
    }),
  }
}

export function siteUrl(slug) {
  return `${window.location.origin}${window.location.pathname}#/site/${slug}`
}

// Google-friendly structured data emitted on every published site. Helps the
// site appear in the Local Pack / Maps, which for mobile-first SA discovery
// often matters more than the website itself.
export function buildBusinessSchema(site) {
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: site.name,
    description: site.offer,
    areaServed: site.location,
    address: { '@type': 'PostalAddress', addressLocality: site.location, addressCountry: 'ZA' },
  }
  if (site.email) schema.email = site.email
  if (site.domain) schema.url = `https://${site.domain}`
  if (site.servicesList?.length) {
    schema.makesOffer = site.servicesList.map((service) => ({
      '@type': 'Offer',
      itemOffered: { '@type': 'Service', name: service },
    }))
  }
  return schema
}
