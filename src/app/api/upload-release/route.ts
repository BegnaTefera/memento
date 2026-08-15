import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import type { EventDoc, GuestDoc } from "@/lib/types";

export const runtime = "nodejs";

/**
 * POST /api/upload-release
 * Body: { eventId: string, guestId: string }
 *
 * Gives back a slot reserved by /api/upload-authorize when the upload it
 * was reserved for never actually completed (the direct-to-Cloudinary
 * upload failed, or the confirm step failed). Without this, every failed
 * attempt — which happens more than you'd like over real mobile
 * connections — would permanently count against the guest/event caps with
 * no photo to show for it, eventually locking guests out despite having
 * fewer real photos than their limit.
 *
 * Never fails loudly: worst case a slot stays "spent" and the guest (or
 * host, via Edit) just has a little less headroom than expected — better
 * than blocking the guest's retry on this endpoint's own reliability.
 */
export async function POST(req: NextRequest) {
  try {
    const { eventId, guestId } = await req.json();
    if (!eventId || !guestId) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const eventRef = adminDb.collection("events").doc(eventId);
    const guestRef = adminDb.collection("guests").doc(guestId);

    await adminDb.runTransaction(async (tx) => {
      const [eventSnap, guestSnap] = await Promise.all([
        tx.get(eventRef),
        tx.get(guestRef),
      ]);
      if (eventSnap.exists) {
        const event = eventSnap.data() as EventDoc;
        tx.update(eventRef, { totalPhotos: Math.max(0, (event.totalPhotos ?? 0) - 1) });
      }
      if (guestSnap.exists) {
        const guest = guestSnap.data() as GuestDoc;
        tx.update(guestRef, { photosTaken: Math.max(0, (guest.photosTaken ?? 0) - 1) });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("upload-release error:", err);
    // Soft-fail on purpose — see comment above.
    return NextResponse.json({ ok: false });
  }
}
