import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { isRequestFromHost } from "@/lib/hostAuth";
import { deleteAuthenticatedPhoto } from "@/lib/cloudinary";
import type { EventDoc, PhotoDoc } from "@/lib/types";

export const runtime = "nodejs";

/**
 * DELETE /api/events/[eventId]
 * Header: Authorization: Bearer <host's Firebase ID token>
 *
 * Fully removes an event: every photo's Cloudinary asset, every photo/guest
 * Firestore doc, and the event doc itself. Deleting the event doc alone
 * (which the host COULD do directly from the client, since Firestore rules
 * already allow it) would leave orphaned photos sitting in Cloudinary
 * storage forever — this route is what actually frees that up.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;

  const eventRef = adminDb.collection("events").doc(eventId);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }
  const event = eventSnap.data() as EventDoc;

  if (!(await isRequestFromHost(req, event.hostUid))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const photosSnap = await adminDb
    .collection("photos")
    .where("eventId", "==", eventId)
    .get();

  // Delete Cloudinary assets first — if this partially fails, we still want
  // the Firestore docs cleaned up rather than leaving a half-deleted event
  // the host can't see or retry from the UI. Any Cloudinary failures are
  // logged, not fatal, since a stray asset is a much smaller problem than a
  // stuck "can't delete" event.
  await Promise.all(
    photosSnap.docs.map(async (doc) => {
      const photo = doc.data() as PhotoDoc;
      try {
        await deleteAuthenticatedPhoto(photo.cloudinaryPublicId);
      } catch (err) {
        console.error(
          `Failed to delete Cloudinary asset ${photo.cloudinaryPublicId}:`,
          err
        );
      }
    })
  );

  const guestsSnap = await adminDb
    .collection("guests")
    .where("eventId", "==", eventId)
    .get();

  const batch = adminDb.batch();
  photosSnap.docs.forEach((doc) => batch.delete(doc.ref));
  guestsSnap.docs.forEach((doc) => batch.delete(doc.ref));
  batch.delete(eventRef);
  await batch.commit();

  return NextResponse.json({ ok: true });
}
