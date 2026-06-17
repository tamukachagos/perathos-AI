import { initialBusiness, launchSteps } from './platformData'

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

export function slugify(value) {
  const slug = value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'new-business'
}

export function getHashRoute() {
  if (typeof window === 'undefined') return { type: 'dashboard' }

  const hash = window.location.hash.replace(/^#\/?/, '')
  const [view, slug] = hash.split('/')

  if (view === 'site' && slug) {
    return { type: 'site', slug }
  }

  return { type: 'dashboard' }
}

export function buildPublishedSite(business) {
  const slug = slugify(business.name)
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
    launchRecord: launchSteps.map(({ id, title, provider, status }) => ({
      id,
      title,
      provider,
      status: status === 'review' ? 'approval-required' : status,
    })),
  }
}

export function siteUrl(slug) {
  return `${window.location.origin}${window.location.pathname}#/site/${slug}`
}
