"use client";

import { useState } from "react";
import Link from "next/link";

export default function Home() {
  const [lit, setLit] = useState(false);
  const [flashing, setFlashing] = useState(false);

  function handlePeek() {
    setFlashing(true);
    setLit(true);
    setTimeout(() => setFlashing(false), 500);
    setTimeout(() => setLit(false), 1400);
  }

  return (
    <>
      <nav className="w-full max-w-5xl mx-auto flex items-center justify-between px-6 py-6">
        <span className="font-hero text-2xl text-text-hi">MEMENTO</span>
        <Link href="/host" className="text-sm text-text-lo hover:text-text-hi transition">
          Host sign in →
        </Link>
      </nav>

      <main className="flex-1 flex flex-col items-center px-6">
        {/* ── Hero ─────────────────────────────────────────── */}
        <section className="w-full max-w-5xl mx-auto flex flex-col items-center text-center gap-8 py-8 md:py-14">
          <div
            className="hero-scene w-full max-w-3xl aspect-[4/3] md:aspect-[21/9]"
            data-lit={lit}
            data-flashing={flashing}
          >
            <div className="hero-flash-overlay" aria-hidden="true" />

            <div
              className="hero-bokeh"
              style={{ width: 90, height: 90, top: "10%", left: "16%", background: "var(--flash)" }}
              aria-hidden="true"
            />
            <div
              className="hero-bokeh"
              style={{ width: 56, height: 56, top: "20%", left: "70%", background: "var(--violet)" }}
              aria-hidden="true"
            />
            <div
              className="hero-bokeh"
              style={{ width: 44, height: 44, top: "8%", left: "48%", background: "var(--flash)" }}
              aria-hidden="true"
            />
            <div
              className="hero-bokeh"
              style={{ width: 66, height: 66, top: "26%", left: "86%", background: "var(--counter-red)" }}
              aria-hidden="true"
            />

            <svg
              viewBox="0 0 800 300"
              className="absolute bottom-0 left-0 w-full h-2/3"
              preserveAspectRatio="xMidYMax slice"
              aria-hidden="true"
            >
              <g className="hero-silhouette">
                <ellipse cx="120" cy="300" rx="55" ry="90" />
                <circle cx="120" cy="185" r="30" />
              </g>
              <g className="hero-silhouette">
                <ellipse cx="260" cy="300" rx="60" ry="100" />
                <circle cx="260" cy="175" r="32" />
                <rect x="288" y="118" width="14" height="72" rx="7" transform="rotate(-28 288 118)" />
              </g>
              <g className="hero-silhouette">
                <ellipse cx="420" cy="300" rx="58" ry="95" />
                <circle cx="420" cy="180" r="31" />
              </g>
              <g className="hero-silhouette">
                <ellipse cx="570" cy="300" rx="62" ry="102" />
                <circle cx="570" cy="172" r="33" />
                <rect x="598" y="106" width="14" height="76" rx="7" transform="rotate(-32 598 106)" />
              </g>
              <g className="hero-silhouette">
                <ellipse cx="700" cy="300" rx="52" ry="88" />
                <circle cx="700" cy="188" r="29" />
              </g>
            </svg>

            <button
              onClick={handlePeek}
              className="absolute bottom-4 right-4 text-xs font-mono-counter tracking-wide text-text-lo hover:text-flash transition bg-black/30 backdrop-blur-sm rounded-full px-3 py-1.5 border border-glass-border"
            >
              tap to peek
            </button>
          </div>

          <div className="flex flex-col gap-0.5">
            <h1 className="font-hero text-5xl md:text-7xl leading-[0.95] text-text-lo">
              NOTHING TO SEE
            </h1>
            <h1 className="font-hero text-5xl md:text-7xl leading-[0.95] text-flash">
              YET.
            </h1>
          </div>

          <p className="max-w-md text-text-lo">
            Memento is a shared disposable camera for your event. Guests capture
            from their own phones — no app, no peeking — until you&apos;re ready
            for the reveal.
          </p>

          <div className="flex flex-col items-center gap-3">
            <Link
              href="/host"
              className="flash-pulse flex items-center gap-3 rounded-full bg-flash text-ink font-semibold py-3.5 px-7 hover:brightness-105 transition"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-counter-red" aria-hidden="true" />
              Set up an event
            </Link>
            <p className="text-xs text-text-lo">
              Got a link from a host? Just open it — no download, no login.
            </p>
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────── */}
        <section className="w-full max-w-2xl mx-auto py-14 flex flex-col gap-9">
          <HowStep
            number="01"
            title="Set the roll"
            desc="Create an event — how many shots each guest gets, and when it starts and ends."
          />
          <HowStep
            number="02"
            title="Hand out the link"
            desc="Guests scan a QR code and start shooting from their own phones. No install, no account."
          />
          <HowStep
            number="03"
            title="Develop the reveal"
            desc="At the time you choose, every shot unlocks at once — and posts straight to your Telegram."
          />
        </section>

        {/* ── Features ─────────────────────────────────────── */}
        <section className="w-full max-w-4xl mx-auto pb-20 grid md:grid-cols-3 gap-4">
          <FeatureCard
            title="Full resolution"
            desc="Captures at your camera's real resolution, not a compressed preview — good enough to print."
          />
          <FeatureCard
            title="No app required"
            desc="Guests just open a link. Works in any phone's browser."
          />
          <FeatureCard
            title="Locked until the reveal"
            desc="Nobody — including you — sees a single photo before the moment you choose."
          />
        </section>
      </main>

      <footer className="w-full max-w-5xl mx-auto px-6 py-8 text-center text-xs text-text-lo">
        MEMENTO
      </footer>
    </>
  );
}

function HowStep({ number, title, desc }: { number: string; title: string; desc: string }) {
  return (
    <div className="flex gap-5 items-start text-left">
      <span className="font-mono-counter text-sm text-counter-red pt-1 shrink-0">{number}</span>
      <div>
        <h3 className="font-display text-lg font-semibold text-text-hi">{title}</h3>
        <p className="text-text-lo text-sm mt-1">{desc}</p>
      </div>
    </div>
  );
}

function FeatureCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="glass p-5 flex flex-col gap-2 text-left">
      <h3 className="font-display text-base font-semibold text-text-hi">{title}</h3>
      <p className="text-text-lo text-sm">{desc}</p>
    </div>
  );
}
