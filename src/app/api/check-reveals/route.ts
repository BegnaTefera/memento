import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { getSignedPhotoUrl } from "@/lib/cloudinary";
import { sendTelegramPhotoAlbum } from "@/lib/telegram";
import type { EventDoc, PhotoDoc } from "@/lib/types";

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
 * that event's Telegram chat.
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

async function revealEvent(event: EventDoc) {
  const photosSnap = await adminDb
    .collection("photos")
    .where("eventId", "==", event.id)
    .get();

  const photoUrls: string[] = photosSnap.docs.map((doc) => {
    const photo = doc.data() as PhotoDoc;
    return getSignedPhotoUrl(photo.cloudinaryPublicId);
  });

  if (event.telegramChatId && photoUrls.length > 0) {
    await sendTelegramPhotoAlbum(
      event.telegramChatId,
      photoUrls,
      `📸 ${event.name} — the reveal is here! (${photoUrls.length} photos)`
    );
  }

  await adminDb.collection("events").doc(event.id).update({ revealed: true });
}
