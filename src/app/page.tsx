import Link from "next/link";

export default function Home() {
  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="glass max-w-md w-full p-8 flex flex-col gap-6 text-center">
        <div>
          <p className="font-mono-counter text-sm text-text-lo tracking-widest mb-2">
            001 / ∞
          </p>
          <h1 className="font-display text-4xl font-bold text-text-hi">
            Memento
          </h1>
          <p className="text-text-lo mt-2">
            A shared disposable camera for your event. Every shot stays
            hidden until the reveal.
          </p>
        </div>

        <Link
          href="/host"
          className="flash-pulse rounded-full bg-flash text-ink font-semibold py-3 px-6 hover:brightness-105 transition"
        >
          Set up an event
        </Link>

        <p className="text-text-lo text-sm">
          Got an invite? Scan the QR code your host shared, or open the link
          they sent you — no account needed.
        </p>
      </div>
    </main>
  );
}
