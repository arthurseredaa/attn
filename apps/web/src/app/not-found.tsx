import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Page not found</h1>
      <p className="text-muted">There is nothing at this address.</p>
      <Link href="/" className="text-accent underline">
        Back to the home page
      </Link>
    </div>
  );
}
