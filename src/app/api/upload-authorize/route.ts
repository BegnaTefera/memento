import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { adminDb } from "@/lib/firebaseAdmin";
import { createSignedUploadParams } from "@/lib/cloudinary";
import type { EventDoc, GuestDoc } from "@/lib/types";

export const runtime = "nodejs";

/**
 * POST /api/upload-authorize
 * Body: { eventId: string, guestId: string }
 *
 * Step 1 of 2 for uploading a photo — this is a small JSON request with no
 * image bytes, so it isn't subject to Vercel's 4.5MB body limit. It does
 * everything that used to happen in the old single-step upload route EXCEPT
 * actually receiving the image: checks the event's revealed state and time
 * window, then atomically enforces both the per-guest cap and the event-wide
 * total cap and reserves a slot. On success it returns a signed Cloudinary
 * upload authorization — the browser then uploads the actual photo directly
 * to Cloudinary (see /api/upload-confirm for step 2, after that succeeds).
 */
export async function POST(req: NextRequest) {
  try {
    const { eventId, guestId } = await req.json();
    if (!eventId || !guestId) {
      return NextResponse.json(
        { error: "Missing eventId or guestId" },
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
    const upload = createSignedUploadParams(eventId, photoId);

    return NextResponse.json({
      ok: true,
      photoId,
      photosTaken: result.guestCount,
      capRemaining: event.photoCapPerGuest - result.guestCount,
      upload,
    });
  } catch (err) {
    console.error("upload-authorize error:", err);
    return NextResponse.json({ error: "Authorization failed" }, { status: 500 });
  }
}
