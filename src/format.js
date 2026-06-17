// Pure, dependency-free helpers shared by the data layer and the provider adapters.
// Kept separate from siteEngine/adapters to avoid circular imports.

export function isFilled(value) {
  return typeof value === 'string' && value.trim().length > 0
}

export function isValidEmail(value) {
  if (!isFilled(value)) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

// South African numbers: accept "+27 82 555 0198", "082 555 0198", "2782...".
// Returns digits only in international form (27XXXXXXXXX) for wa.me, or '' if unusable.
export function normalizeWhatsapp(raw) {
  const digits = (raw || '').replace(/\D/g, '')
  if (/^27\d{9}$/.test(digits)) return digits
  if (/^0\d{9}$/.test(digits)) return `27${digits.slice(1)}`
  return digits
}

export function isValidWhatsapp(raw) {
  const digits = (raw || '').replace(/\D/g, '')
  return /^27\d{9}$/.test(digits) || /^0\d{9}$/.test(digits)
}

// Click-to-chat link. Free, no WhatsApp API account needed — the right SA default.
export function whatsappLink(raw, text) {
  const number = normalizeWhatsapp(raw)
  const query = isFilled(text) ? `?text=${encodeURIComponent(text)}` : ''
  return `https://wa.me/${number}${query}`
}

export function slugify(value) {
  const slug = (value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'new-business'
}

// Initials for the logo tile — guards against empty/blank names that previously
// produced "undefined" artifacts.
export function initialsOf(name) {
  const letters = (name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .filter(Boolean)
    .join('')

  return letters || 'LD'
}
