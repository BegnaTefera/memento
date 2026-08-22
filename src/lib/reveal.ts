import { adminDb } from "@/lib/firebaseAdmin";
import { getSignedPhotoUrl } from "@/lib/cloudinary";
import { sendTelegramMessage, sendTelegramPhotoAlbum } from "@/lib/telegram";
import type { EventDoc, PhotoDoc } from "@/lib/types";

function formatEventDate(ms: number, includeDate = true): string {
  return new Date(ms).toLocaleString("en-US", {
    ...(includeDate
      ? { weekday: "short", month: "short", day: "numeric", year: "numeric" }
      : { hour: "numeric", minute: "2-digit" }),
    ...(includeDate ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

function formatEventRange(startsAt: number, endsAt: number): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();

  if (sameDay) {
    return `${formatEventDate(startsAt)} – ${formatEventDate(endsAt, false)}`;
  }

  return `${formatEventDate(startsAt)} – ${formatEventDate(endsAt)}`;
}

function buildRevealSummary(event: EventDoc, photoCount: number): string {
  return [
    "📸 MEMENTO REVEAL",
    "",
    event.name,
    "",
    `The full album is revealed: ${photoCount} photo${photoCount === 1 ? "" : "s"}`,
    `Event: ${formatEventRange(event.startsAt, event.endsAt)}`,
    "",
    "Thanks for making the memories.",
  ].join("\n");
}

/**
 * Unlocks an event's gallery and posts the album to its Telegram chat (if
 * one is set). Shared between the scheduled cron check and the host's
 * manual "Reveal now" button — same effect either way, just triggered
 * differently. Safe to call on an already-revealed event (no-ops).
 */
export async function revealEvent(event: EventDoc) {
  if (event.revealed) return;

  const photosSnap = await adminDb
    .collection("photos")
    .where("eventId", "==", event.id)
    .get();

  const photoUrls: string[] = photosSnap.docs.map((doc) => {
    const photo = doc.data() as PhotoDoc;
    return getSignedPhotoUrl(photo.cloudinaryPublicId);
  });

  if (event.telegramChatId && photoUrls.length > 0) {
    // Send the album without a caption so the event summary appears after
    // every image, including albums split into multiple Telegram messages.
    await sendTelegramPhotoAlbum(event.telegramChatId, photoUrls);
    await sendTelegramMessage(
      event.telegramChatId,
      buildRevealSummary(event, photoUrls.length)
    );
  }

  await adminDb.collection("events").doc(event.id).update({ revealed: true });
}
