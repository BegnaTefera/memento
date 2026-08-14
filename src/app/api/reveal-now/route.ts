import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { isRequestFromHost } from "@/lib/hostAuth";
import { revealEvent } from "@/lib/reveal";
import type { EventDoc } from "@/lib/types";

export const runtime = "nodejs";

/**
 * POST /api/reveal-now
 * Body: { eventId: string }
 * Header: Authorization: Bearer <host's Firebase ID token>
 *
 * Lets the host trigger the reveal immediately, instead of waiting for the
 * scheduled time (or ever, for "immediate" mode events that never get an
 * automatic reveal). Works for any not-yet-revealed event.
 */
export async function POST(req: NextRequest) {
  const { eventId } = await req.json();
  if (!eventId) {
    return NextResponse.json({ error: "Missing eventId" }, { status: 400 });
  }

  const eventRef = adminDb.collection("events").doc(eventId);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }
  const event = eventSnap.data() as EventDoc;

  if (!(await isRequestFromHost(req, event.hostUid))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (event.revealed) {
    return NextResponse.json({ error: "Already revealed" }, { status: 409 });
  }

  try {
    await revealEvent(event);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("reveal-now error:", err);
    return NextResponse.json({ error: "Reveal failed" }, { status: 500 });
  }
}
