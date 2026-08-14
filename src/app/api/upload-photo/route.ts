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
 * Every limit here is enforced server-side, inside one transaction — the
 * per-guest cap, the event-wide total cap, and the start/end time window.
 * Anything shown to the guest client-side is just UX; bypassing the client
 * (devtools, curl) still hits all of these the same way.
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
        { error: "This event has already ended", reason: "ended" },
        { status: 403 }
      );
    }

    const now = Date.now();
    if (now < event.startsAt) {
      return NextResponse.json(
        { error: "This event hasn't started yet", reason: "not-started", startsAt: event.startsAt },
        { status: 403 }
      );
    }
    if (now > event.endsAt) {
      return NextResponse.json(
        { error: "This event has ended", reason: "ended" },
        { status: 403 }
      );
    }

    const guestRef = adminDb.collection("guests").doc(guestId);

    // Transaction so concurrent uploads (same guest, or different guests at
    // once) can't both slip past a cap check before either one updates the
    // counters they depend on.
    const result = await adminDb.runTransaction(async (tx) => {
      const [guestSnap, freshEventSnap] = await Promise.all([
        tx.get(guestRef),
        tx.get(eventRef),
      ]);
      const guest = guestSnap.exists ? (guestSnap.data() as GuestDoc) : null;
      const currentGuestCount = guest?.photosTaken ?? 0;
      const freshEvent = freshEventSnap.data() as EventDoc;
      const currentTotal = freshEvent.totalPhotos ?? 0;

      if (currentGuestCount >= freshEvent.photoCapPerGuest) {
        return { allowed: false as const, reason: "guest-cap" as const };
      }
      if (currentTotal >= freshEvent.maxTotalPhotos) {
        return { allowed: false as const, reason: "event-cap" as const };
      }

      if (!guestSnap.exists) {
        tx.set(guestRef, {
          id: guestId,
          eventId,
          photosTaken: 1,
          createdAt: Date.now(),
        } as GuestDoc);
      } else {
        tx.update(guestRef, { photosTaken: currentGuestCount + 1 });
      }
      tx.update(eventRef, { totalPhotos: currentTotal + 1 });

      return {
        allowed: true as const,
        guestCount: currentGuestCount + 1,
        totalCount: currentTotal + 1,
      };
    });

    if (!result.allowed) {
      const message =
        result.reason === "event-cap"
          ? "This event has reached its total photo limit"
          : "Photo cap reached for this guest";
      return NextResponse.json(
        { error: message, reason: result.reason },
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
      photosTaken: result.guestCount,
      capRemaining: event.photoCapPerGuest - result.guestCount,
    });
  } catch (err) {
    console.error("upload-photo error:", err);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
