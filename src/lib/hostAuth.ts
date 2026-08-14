import { NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";

/**
 * Verifies the request's "Authorization: Bearer <Firebase ID token>" header
 * belongs to the given hostUid. Used by every route that needs to confirm
 * "is this actually the event's host" — gallery, delete, reveal-now, edit.
 */
export async function isRequestFromHost(
  req: NextRequest,
  hostUid: string
): Promise<boolean> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  try {
    const token = authHeader.slice("Bearer ".length);
    const decoded = await adminAuth.verifyIdToken(token);
    return decoded.uid === hostUid;
  } catch {
    return false;
  }
}
