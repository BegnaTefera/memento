import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { getSignedPhotoUrl } from "@/lib/cloudinary";
import { isRequestFromHost } from "@/lib/hostAuth";
import type { EventDoc, PhotoDoc } from "@/lib/types";

export const runtime = "nodejs";

/**
 * GET /api/gallery?eventId=...
 * Optional header: Authorization: Bearer <Firebase ID token> (host only)
 *
 * Photos are only ever exposed through this route (never direct Firestore/Storage
 * reads from the client) so we can enforce: guests only see a shared gallery
 * AFTER reveal, while the host can always see their own event's photos.
 */
export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get("eventId");
  if (!eventId) {
    return NextResponse.json({ error: "Missing eventId" }, { status: 400 });
  }

  const eventSnap = await adminDb.collection("events").doc(eventId).get();
  if (!eventSnap.exists) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }
  const event = eventSnap.data() as EventDoc;

  const isHost = await isRequestFromHost(req, event.hostUid);

  if (!isHost && !(event.revealed && event.galleryMode === "shared")) {
    return NextResponse.json(
      { error: "Gallery isn't available yet" },
      { status: 403 }
    );
  }

  const photosSnap = await adminDb
    .collection("photos")
    .where("eventId", "==", eventId)
    .get();

  const photos = photosSnap.docs.map((doc) => {
    const photo = doc.data() as PhotoDoc;
    return {
      id: photo.id,
      url: getSignedPhotoUrl(photo.cloudinaryPublicId),
      createdAt: photo.createdAt,
    };
  });

  return NextResponse.json({ photos, revealed: event.revealed });
}