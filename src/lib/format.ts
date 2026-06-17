// Pure, dependency-free helpers shared by the data layer and the provider adapters.
// Kept separate from the engine/adapters to avoid circular imports.
//
// Ported VERBATIM (behaviour-identical) from the Vite prototype's src/format.js.

export function isFilled(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isValidEmail(value: string | undefined | null): boolean {
  if (!isFilled(value)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

// South African numbers: accept "+27 82 555 0198", "082 555 0198", "2782...".
// Returns digits only in international form (27XXXXXXXXX) for wa.me, or '' if unusable.
export function normalizeWhatsapp(raw: string | undefined | null): string {
  const digits = (raw || "").replace(/\D/g, "");
  if (/^27\d{9}$/.test(digits)) return digits;
  if (/^0\d{9}$/.test(digits)) return `27${digits.slice(1)}`;
  return digits;
}

export function isValidWhatsapp(raw: string | undefined | null): boolean {
  const digits = (raw || "").replace(/\D/g, "");
  return /^27\d{9}$/.test(digits) || /^0\d{9}$/.test(digits);
}

// Click-to-chat link. Free, no WhatsApp API account needed — the right SA default.
export function whatsappLink(raw: string | undefined | null, text?: string): string {
  const number = normalizeWhatsapp(raw);
  const query = isFilled(text) ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${number}${query}`;
}

export function slugify(value: string | undefined | null): string {
  const slug = (value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "new-business";
}

// Initials for the logo tile — guards against empty/blank names that previously
// produced "undefined" artifacts.
export function initialsOf(name: string | undefined | null): string {
  const letters = (name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .filter(Boolean)
    .join("");

  return letters || "LD";
}
