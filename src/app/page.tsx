"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, type Variants } from "framer-motion";
import { ImageDown, Lock, QrCode } from "lucide-react";
import MagneticWrap from "@/components/MagneticWrap";

const containerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12 } },
};
const itemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
};

export default function Home() {
  const [introDone, setIntroDone] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setIntroDone(true), 700);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      {!introDone && (
        <motion.div
          className="flash-intro"
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.55, delay: 0.15, ease: "easeOut" }}
        />
      )}

      <nav className="w-full border-b border-border">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-6 py-5">
          <span className="font-display text-xl font-semibold text-text-hi">Memento</span>
          <Link href="/host" data-cursor-hover className="text-sm text-text-lo hover:text-text-hi transition">
            Host sign in →
          </Link>
        </div>
      </nav>

      <main className="flex-1 flex flex-col items-center px-6">
        {/* ── Hero ─────────────────────────────────────────── */}
        <section className="w-full max-w-5xl mx-auto grid md:grid-cols-2 items-center gap-12 py-14 md:py-24">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4, ease: "easeOut" }}
            className="flex flex-col gap-6 text-left"
          >
            <h1 className="font-display text-5xl md:text-6xl font-semibold leading-[1.05] text-text-hi">
              Nothing to see —<br />
              <span className="text-accent">yet.</span>
            </h1>
            <p className="max-w-md text-text-lo text-lg">
              Memento is a shared disposable camera for your event. Guests capture
              from their own phones — no app, no peeking — until you&apos;re ready
              for the reveal.
            </p>
            <div className="flex flex-col items-start gap-3">
              <MagneticWrap>
                <Link href="/host" data-cursor-hover className="btn btn-primary">
                  Set up an event
                  <span aria-hidden="true">→</span>
                </Link>
              </MagneticWrap>
              <p className="text-xs text-text-lo">
                Got a link from a host? Just open it — no download, no login.
              </p>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.55, ease: "easeOut" }}
            className="flex justify-center md:justify-end"
          >
            <PhoneMockup />
          </motion.div>
        </section>

        {/* ── How it works ─────────────────────────────────── */}
        <motion.section
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          variants={containerVariants}
          className="w-full max-w-2xl mx-auto py-14 flex flex-col gap-8"
        >
          <HowStep
            number={1}
            title="Set the roll"
            desc="Create an event — how many shots each guest gets, and when it starts and ends."
          />
          <HowStep
            number={2}
            title="Hand out the link"
            desc="Guests scan a QR code and start shooting from their own phones. No install, no account."
          />
          <HowStep
            number={3}
            title="Develop the reveal"
            desc="At the time you choose, every shot unlocks at once — and posts straight to your Telegram."
          />
        </motion.section>

        {/* ── Features — plain, no card boxes ───────────────── */}
        <motion.section
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          variants={containerVariants}
          className="w-full max-w-4xl mx-auto pb-24 grid sm:grid-cols-3 gap-10"
        >
          <FeatureItem
            icon={<ImageDown size={22} />}
            title="Full resolution"
            desc="Captures at your camera's real resolution, not a compressed preview — good enough to print."
          />
          <FeatureItem
            icon={<QrCode size={22} />}
            title="No app required"
            desc="Guests just open a link. Works in any phone's browser."
          />
          <FeatureItem
            icon={<Lock size={22} />}
            title="Locked until the reveal"
            desc="Nobody — including you — sees a single photo before the moment you choose."
          />
        </motion.section>
      </main>

      <footer className="w-full border-t border-border">
        <div className="max-w-5xl mx-auto px-6 py-8 text-center text-xs text-text-lo">
          Memento
        </div>
      </footer>
    </>
  );
}

/** A simplified phone frame showing our own guest-capture screen — the
 * actual product, not decorative illustration. */
function PhoneMockup() {
  return (
    <div className="relative w-[240px] aspect-[9/19] rounded-[2.25rem] border-[6px] border-surface-2 bg-ink shadow-2xl overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-16 h-4 bg-surface-2 rounded-b-xl z-10" />
      <div className="absolute inset-0 bg-gradient-to-b from-surface-2 via-surface to-ink" />
      <div className="absolute top-7 left-0 right-0 px-4 text-center">
        <p className="text-[11px] font-medium text-text-hi truncate">Sara &amp; Dan&apos;s wedding</p>
      </div>
      <div className="absolute bottom-5 left-0 right-0 px-4 flex items-end justify-between">
        <div>
          <p className="font-display text-2xl font-semibold leading-none text-text-hi">7</p>
          <p className="text-[9px] text-text-lo uppercase tracking-wide">shots left</p>
        </div>
        <div className="w-12 h-12 rounded-full border-[3px] border-white/85" />
        <div className="w-7 h-7 rounded-md bg-surface-2 border border-border" />
      </div>
    </div>
  );
}

function HowStep({ number, title, desc }: { number: number; title: string; desc: string }) {
  return (
    <motion.div variants={itemVariants} className="flex gap-5 items-start text-left">
      <span className="avatar-icon bg-accent-dim text-accent font-display font-semibold shrink-0">
        {number}
      </span>
      <div>
        <h3 className="font-display text-lg font-semibold text-text-hi">{title}</h3>
        <p className="text-text-lo text-sm mt-1">{desc}</p>
      </div>
    </motion.div>
  );
}

function FeatureItem({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <motion.div variants={itemVariants} className="flex flex-col gap-3 text-left">
      <div className="text-accent">{icon}</div>
      <h3 className="font-display text-base font-semibold text-text-hi">{title}</h3>
      <p className="text-text-lo text-sm">{desc}</p>
    </motion.div>
  );
}
