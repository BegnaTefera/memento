import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { adminDb } from "@/lib/firebaseAdmin";
import { uploadAuthenticatedPhoto } from "@/lib/cloudinary";
import type { EventDoc, GuestDoc } from "@/lib/types";

export const runtime = "nodejs";

/**
 * POST /api/upload-photo
 * Body: { eventId: string, guestId: string, imageBase64: string }
 * imageBase64 is a data URL, e.g. "data:image/jpeg;base64,/9j/4AAQ..."
 *
 * The photo cap is enforced HERE, server-side — the client-side counter shown
 * to guests is just UX. Anyone bypassing the client (devtools, curl) still hits
 * this check, since it reads the guest's real count from Firestore.
 */
export async function POST(req: NextRequest) {
  try {
    const { eventId, guestId, imageBase64 } = await req.json();

    if (!eventId || !guestId || !imageBase64) {
      return NextResponse.json(
        { error: "Missing eventId, guestId, or imageBase64" },
        { status: 400 }
      );
    }

    const eventRef = adminDb.collection("events").doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    const event = eventSnap.data() as EventDoc;

    if (event.revealed) {
      return NextResponse.json(
        { error: "This event has already ended" },
        { status: 403 }
      );
    }

    const guestRef = adminDb.collection("guests").doc(guestId);

    // Transaction so two rapid uploads from the same guest can't both slip
    // past the cap check before either one increments the counter.
    const result = await adminDb.runTransaction(async (tx) => {
      const guestSnap = await tx.get(guestRef);
      const guest = guestSnap.exists ? (guestSnap.data() as GuestDoc) : null;
      const currentCount = guest?.photosTaken ?? 0;

      if (currentCount >= event.photoCapPerGuest) {
        return { allowed: false, currentCount };
      }

      if (!guestSnap.exists) {
        tx.set(guestRef, {
          id: guestId,
          eventId,
          photosTaken: 1,
          createdAt: Date.now(),
        } as GuestDoc);
      } else {
        tx.update(guestRef, { photosTaken: currentCount + 1 });
      }

      return { allowed: true, currentCount: currentCount + 1 };
    });

    if (!result.allowed) {
      return NextResponse.json(
        { error: "Photo cap reached for this guest", cap: event.photoCapPerGuest },
        { status: 403 }
      );
    }

    const photoId = randomUUID();
    // imageBase64 is passed straight through — Cloudinary accepts data URLs directly,
    // no need to strip the prefix or decode it ourselves.
    const cloudinaryPublicId = await uploadAuthenticatedPhoto(
      imageBase64,
      eventId,
      photoId
    );

    await adminDb.collection("photos").doc(photoId).set({
      id: photoId,
      eventId,
      guestId,
      cloudinaryPublicId,
      createdAt: Date.now(),
    });

    return NextResponse.json({
      ok: true,
      photoId,
      photosTaken: result.currentCount,
      capRemaining: event.photoCapPerGuest - result.currentCount,
    });
  } catch (err) {
    console.error("upload-photo error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
