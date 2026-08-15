"use client";

import { use, useEffect, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { captureHighQualityPhoto } from "@/lib/imageCapture";
import {
  getStagedPhotos,
  setStagedPhotos,
  type StagedPhoto,
} from "@/lib/stagedPhotosDb";
import type { EventDoc, GuestDoc } from "@/lib/types";

const GUEST_ID_KEY_PREFIX = "memento_guest_id_";

/**
 * crypto.randomUUID() only exists in secure contexts (HTTPS, or the
 * special-cased "localhost") — it's undefined if you open this page over
 * plain HTTP via a LAN IP (e.g. testing from your phone on the same wifi).
 * Guest/photo IDs don't need cryptographic randomness, just uniqueness, so
 * we fall back to a simple random string instead of hard-failing.
 */
function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getOrCreateGuestId(eventId: string): string {
  const key = GUEST_ID_KEY_PREFIX + eventId;
  let id = localStorage.getItem(key);
  if (!id) {
    id = generateId();
    localStorage.setItem(key, id);
  }
  return id;
}

type WindowState = "loading" | "not-found" | "not-started" | "open" | "ended";

export default function GuestCapturePage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = use(params);

  const [event, setEvent] = useState<EventDoc | null>(null);
  const [guestId, setGuestId] = useState<string | null>(null);
  const [alreadyUploaded, setAlreadyUploaded] = useState(0);
  const [staged, setStaged] = useState<StagedPhoto[]>([]);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [windowState, setWindowState] = useState<WindowState>("loading");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const [errorMsg, setErrorMsg] = useState("");
  const [flash, setFlash] = useState(false);
  const [capturing, setCapturing] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Load event, guest id, already-uploaded count, and any staged photos left
  // over from a previous visit (survives a full browser close, via IndexedDB).
  useEffect(() => {
    let cancelled = false;

    async function load() {
      const eventSnap = await getDoc(doc(db, "events", eventId));
      if (cancelled) return;
      if (!eventSnap.exists()) {
        setWindowState("not-found");
        return;
      }
      const eventData = eventSnap.data() as EventDoc;
      setEvent(eventData);

      const gid = getOrCreateGuestId(eventId);
      setGuestId(gid);

      const [guestSnap, stagedPhotos] = await Promise.all([
        getDoc(doc(db, "guests", gid)),
        getStagedPhotos(eventId, gid),
      ]);
      if (cancelled) return;

      if (guestSnap.exists()) {
        setAlreadyUploaded((guestSnap.data() as GuestDoc).photosTaken);
      }
      setStaged(stagedPhotos);

      const now = Date.now();
      if (eventData.revealed || now > eventData.endsAt) {
        setWindowState("ended");
      } else if (now < eventData.startsAt) {
        setWindowState("not-started");
      } else {
        setWindowState("open");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  // Camera only runs while the event window is actually open. Requesting a
  // high resolution explicitly matters a lot here — without it, browsers
  // default to a modest preview resolution meant for smooth playback, not
  // anything close to what the camera can actually capture.
  useEffect(() => {
    if (windowState !== "open") return;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 4096 },
          height: { ideal: 2304 },
        },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => setErrorMsg("Camera access denied — check your browser permissions."));
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [windowState]);

  // Object URLs for thumbnails — created/revoked as the staged list changes,
  // so we don't leak memory across a long guest session.
  useEffect(() => {
    setThumbUrls((prev) => {
      const next: Record<string, string> = {};
      for (const photo of staged) {
        next[photo.id] = prev[photo.id] ?? URL.createObjectURL(photo.blob);
      }
      for (const id of Object.keys(prev)) {
        if (!(id in next)) URL.revokeObjectURL(prev[id]);
      }
      return next;
    });
  }, [staged]);
  useEffect(() => {
    return () => {
      Object.values(thumbUrls).forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cap = event?.photoCapPerGuest ?? 0;
  const remaining = cap - alreadyUploaded - staged.length;

  async function persistStaged(next: StagedPhoto[]) {
    setStaged(next);
    if (guestId) await setStagedPhotos(eventId, guestId, next);
  }

  async function takePhoto() {
    if (!guestId || remaining <= 0 || capturing) return;
    const video = videoRef.current;
    const track = streamRef.current?.getVideoTracks()[0];
    if (!video || !track) return;

    setCapturing(true);
    setErrorMsg("");
    try {
      const blob = await captureHighQualityPhoto(video, track);
      setFlash(true);
      setTimeout(() => setFlash(false), 200);
      const photo: StagedPhoto = { id: generateId(), blob, capturedAt: Date.now() };
      await persistStaged([...staged, photo]);
    } catch (err) {
      console.error("Capture failed:", err);
      setErrorMsg("Couldn't capture that shot — try again.");
    } finally {
      setCapturing(false);
    }
  }

  function removeStaged(id: string) {
    persistStaged(staged.filter((p) => p.id !== id));
  }

  async function uploadOne(photo: StagedPhoto): Promise<
    | { ok: true; photosTaken: number }
    | { ok: false; error: string; reason?: string; startsAt?: number }
  > {
    const authRes = await fetch("/api/upload-authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId, guestId }),
    });
    const authData = await authRes.json();
    if (!authRes.ok) {
      return { ok: false, error: authData.error ?? "Upload failed", reason: authData.reason, startsAt: authData.startsAt };
    }

    const { photoId, upload, photosTaken } = authData;

    // Direct browser → Cloudinary upload. Retried a couple of times since
    // this is the one step going over the open internet to a third party,
    // not through our own infra.
    let cloudinaryOk = false;
    for (let attempt = 0; attempt < 3 && !cloudinaryOk; attempt++) {
      try {
        const form = new FormData();
        form.append("file", photo.blob);
        form.append("api_key", upload.apiKey);
        form.append("timestamp", String(upload.timestamp));
        form.append("signature", upload.signature);
        form.append("public_id", upload.publicId);
        form.append("type", "authenticated");

        const cloudRes = await fetch(
          `https://api.cloudinary.com/v1_1/${upload.cloudName}/image/upload`,
          { method: "POST", body: form }
        );
        cloudinaryOk = cloudRes.ok;
      } catch {
        cloudinaryOk = false;
      }
    }

    if (!cloudinaryOk) {
      return { ok: false, error: "Upload to storage failed — try again." };
    }

    const confirmRes = await fetch("/api/upload-confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId, guestId, photoId, cloudinaryPublicId: upload.publicId }),
    });
    if (!confirmRes.ok) {
      return { ok: false, error: "Upload finished but couldn't be saved — try again." };
    }

    return { ok: true, photosTaken };
  }

  async function uploadAll() {
    if (!guestId || staged.length === 0 || uploading) return;
    setUploading(true);
    setErrorMsg("");

    let remainingPhotos = [...staged];
    const totalToUpload = remainingPhotos.length;
    let uploadedCount = 0;
    setUploadProgress({ done: 0, total: totalToUpload });

    // Sequential, not parallel — keeps the per-guest/per-event cap checks
    // meaningful (each request sees the true up-to-date count) and is
    // gentler on both our functions and Cloudinary than firing a burst at once.
    for (const photo of [...remainingPhotos]) {
      const result = await uploadOne(photo);

      if (!result.ok) {
        if (result.reason === "not-started" || result.reason === "ended") {
          setWindowState(result.reason === "not-started" ? "not-started" : "ended");
        }
        setErrorMsg(result.error);
        break; // stop here — remaining staged photos stay put, nothing lost
      }

      uploadedCount++;
      setAlreadyUploaded(result.photosTaken);
      setUploadProgress({ done: uploadedCount, total: totalToUpload });

      remainingPhotos = remainingPhotos.filter((p) => p.id !== photo.id);
      await persistStaged(remainingPhotos);
    }

    setUploading(false);
  }

  if (windowState === "loading") {
    return <Centered>Loading event…</Centered>;
  }
  if (windowState === "not-found") {
    return <Centered>This event doesn&apos;t exist, or the link is wrong.</Centered>;
  }
  if (windowState === "not-started" && event) {
    return (
      <Centered>
        <div className="glass max-w-sm w-full p-6 flex flex-col gap-2">
          <p className="font-display text-lg font-semibold">{event.name}</p>
          <p>This event hasn&apos;t started yet.</p>
          <p className="text-sm text-text-lo">
            Starts {new Date(event.startsAt).toLocaleString()}
          </p>
        </div>
      </Centered>
    );
  }
  if (windowState === "ended" && event) {
    return (
      <Centered>
        <div className="glass max-w-sm w-full p-6 flex flex-col gap-2">
          <p className="font-display text-lg font-semibold">{event.name}</p>
          <p>This event has ended.</p>
        </div>
      </Centered>
    );
  }
  if (!event) {
    return <Centered>Loading event…</Centered>;
  }

  return (
    <main className="flex-1 flex flex-col items-center justify-center p-4 gap-4">
      <div className="glass w-full max-w-md p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-lg font-semibold">{event.name}</h1>
          <span className="font-mono-counter text-sm text-flash">
            {Math.max(remaining, 0)} / {cap} left
          </span>
        </div>

        <div className="relative rounded-xl overflow-hidden bg-black aspect-[3/4]">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
          {flash && (
            <div className="absolute inset-0 bg-white animate-[flash-pulse_0.2s_ease-out]" />
          )}
        </div>

        {errorMsg && <p className="text-sm text-center text-flash">{errorMsg}</p>}

        <button
          onClick={takePhoto}
          disabled={remaining <= 0 || uploading || capturing}
          className="flash-pulse rounded-full bg-flash text-ink font-semibold py-4 hover:brightness-105 transition disabled:opacity-40"
        >
          {remaining <= 0 ? "No shots left" : capturing ? "Capturing…" : "Take photo"}
        </button>

        {staged.length > 0 && (
          <>
            <div className="grid grid-cols-4 gap-2">
              {staged.map((photo) => (
                <div key={photo.id} className="relative aspect-square rounded-lg overflow-hidden">
                  {thumbUrls[photo.id] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumbUrls[photo.id]}
                      alt="Captured shot, not yet uploaded"
                      className="w-full h-full object-cover"
                    />
                  )}
                  <button
                    onClick={() => removeStaged(photo.id)}
                    disabled={uploading}
                    aria-label="Remove photo"
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 text-white text-sm leading-none flex items-center justify-center disabled:opacity-40"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <button
              onClick={uploadAll}
              disabled={uploading}
              className="rounded-full border border-glass-border text-text-hi font-semibold py-3 hover:bg-white/5 transition disabled:opacity-50"
            >
              {uploading
                ? `Uploading ${uploadProgress.done}/${uploadProgress.total}…`
                : `Upload ${staged.length} photo${staged.length === 1 ? "" : "s"}`}
            </button>
          </>
        )}

        <p className="text-xs text-text-lo text-center">
          Review your shots, remove any you don&apos;t like, then upload when
          you&apos;re ready. Photos stay hidden until the host reveals the
          gallery — like a real disposable camera.
        </p>
      </div>
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex-1 flex items-center justify-center p-6 text-center text-text-lo">
      {children}
    </main>
  );
}
