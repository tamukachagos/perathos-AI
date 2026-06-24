// Vitest stub for the Next.js `server-only` virtual module.
// In production Next.js builds, importing `server-only` throws if the module
// is ever bundled client-side. In Vitest (Vite), the module doesn't exist as
// a real package, so we provide an empty no-op so tests can import server-side
// library files without crashing.
export {};
