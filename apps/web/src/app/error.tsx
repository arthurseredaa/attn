'use client';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Something went wrong</h1>
      <p className="text-muted">The page could not be loaded. Please try again.</p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg"
      >
        Try again
      </button>
    </div>
  );
}
