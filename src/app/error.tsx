"use client";

// App Router error boundary — preserves the prototype's ErrorBoundary UX.
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="app-error">
      <h1>Something went wrong</h1>
      <p>
        Launch Desk hit an unexpected error. Reload to continue — your draft is
        saved locally.
      </p>
      <button type="button" onClick={() => reset()}>
        Reload
      </button>
    </main>
  );
}
