import { adminDb } from "@/lib/firebaseAdmin";
import { getSignedPhotoUrl } from "@/lib/cloudinary";
import { sendTelegramPhotoAlbum } from "@/lib/telegram";
import type { EventDoc, PhotoDoc } from "@/lib/types";

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
    await sendTelegramPhotoAlbum(
      event.telegramChatId,
      photoUrls,
      `📸 ${event.name} — the reveal is here! (${photoUrls.length} photos)`
    );
  }

  await adminDb.collection("events").doc(event.id).update({ revealed: true });
}
