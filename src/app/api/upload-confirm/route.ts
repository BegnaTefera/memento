import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

export const runtime = "nodejs";

/**
 * POST /api/upload-confirm
 * Body: { eventId: string, guestId: string, photoId: string, cloudinaryPublicId: string }
 *
 * Step 2 of 2 — called after the browser's direct upload to Cloudinary
 * (using the signature from /api/upload-authorize) succeeds. Writes the
 * actual PhotoDoc so the photo shows up in the gallery/reveal. The cap
 * enforcement already happened in the authorize step; this is just
 * recording that the reserved slot was actually filled.
 */
export async function POST(req: NextRequest) {
  try {
    const { eventId, guestId, photoId, cloudinaryPublicId } = await req.json();
    if (!eventId || !guestId || !photoId || !cloudinaryPublicId) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    await adminDb.collection("photos").doc(photoId).set({
      id: photoId,
      eventId,
      guestId,
      cloudinaryPublicId,
      createdAt: Date.now(),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("upload-confirm error:", err);
    return NextResponse.json({ error: "Confirm failed" }, { status: 500 });
  }
}
