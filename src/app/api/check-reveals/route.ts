import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { revealEvent } from "@/lib/reveal";
import type { EventDoc } from "@/lib/types";

export const runtime = "nodejs";

/**
 * GET /api/check-reveals?secret=...
 *
 * Meant to be pinged every minute by an external cron (e.g. cron-job.org or
 * a GitHub Actions scheduled workflow) — Vercel's free Hobby plan only allows
 * daily cron jobs, so we drive this from outside Vercel instead.
 *
 * Finds every event where revealMode is "delayed", revealAt has passed, and
 * revealed is still false — then unlocks the gallery and posts the album to
 * that event's Telegram chat. (Hosts can also trigger this early per-event
 * via the "Reveal now" button — see /api/reveal-now.)
 */
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const dueSnap = await adminDb
    .collection("events")
    .where("revealMode", "==", "delayed")
    .where("revealed", "==", false)
    .where("revealAt", "<=", now)
    .get();

  const processed: string[] = [];
  const errors: { eventId: string; error: string }[] = [];

  for (const doc of dueSnap.docs) {
    const event = doc.data() as EventDoc;
    try {
      await revealEvent(event);
      processed.push(event.id);
    } catch (err) {
      console.error(`Failed to reveal event ${event.id}:`, err);
      errors.push({ eventId: event.id, error: String(err) });
    }
  }

  return NextResponse.json({ checked: dueSnap.size, processed, errors });
}
