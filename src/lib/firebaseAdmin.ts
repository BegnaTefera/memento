import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

// Server-only. Uses a service account key — NEVER prefix these env vars with NEXT_PUBLIC_.
// Get the service account JSON from: Firebase Console > Project Settings > Service Accounts > Generate new private key
function getPrivateKey(): string | undefined {
  let key = process.env.FIREBASE_PRIVATE_KEY;
  if (!key) return undefined;

  // If the value was pasted with surrounding quotes intact (e.g. copied
  // straight from the downloaded JSON file, quotes and all), strip them —
  // otherwise the PEM parser sees a malformed key.
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }

  // Handles both forms: a single-line value with literal \n escapes (the
  // usual case when pasted into a one-line env var field), or a value that
  // already has real newlines (if pasted into a multi-line field as-is).
  return key.replace(/\\n/g, "\n");
}

function getAdminApp(): App {
  if (getApps().length) return getApps()[0];

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = getPrivateKey();

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Missing Firebase Admin env vars: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY"
    );
  }
  if (!privateKey.includes("BEGIN PRIVATE KEY")) {
    throw new Error(
      "FIREBASE_PRIVATE_KEY doesn't look like a valid PEM key — check it wasn't pasted with extra quotes or mangled newlines."
    );
  }

  return initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
}

export const adminDb = getFirestore(getAdminApp());
export const adminAuth = getAuth(getAdminApp());