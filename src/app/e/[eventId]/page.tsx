"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { captureHighQualityPhoto } from "@/lib/imageCapture";
import {
  getStagedPhotos,
  setStagedPhotos,
  type StagedPhoto,
} from "@/lib/stagedPhotosDb";
import {
  UPLOAD_GRACE_PERIOD_MS,
  UPLOAD_CONCURRENCY,
  CLOUDINARY_UPLOAD_TIMEOUT_MS,
} from "@/lib/constants";
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

type Phase = "loading" | "not-found" | "not-started" | "open" | "grace" | "ended";

export default function GuestCapturePage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = use(params);

  const [event, setEvent] = useState<EventDoc | null | undefined>(undefined); // undefined = loading, null = not found
  const [guestId, setGuestId] = useState<string | null>(null);
  const [alreadyUploaded, setAlreadyUploaded] = useState(0);
  const [staged, setStaged] = useState<StagedPhoto[]>([]);
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => Date.now());
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const [errorMsg, setErrorMsg] = useState("");
  const [flash, setFlash] = useState(false);
  const [capturing, setCapturing] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Authoritative staged-list snapshot, kept in sync with `staged` state.
  // Needed because concurrent upload workers can each finish at nearly the
  // same instant — mutating through this ref (synchronous, no race) instead
  // of through a possibly-stale closure of `staged` is what keeps concurrent
  // removals from clobbering each other.
  const stagedRef = useRef<StagedPhoto[]>([]);

  // Ticks once a second — drives the "open → grace → ended" transition and
  // the grace-period countdown live, without needing a page reload.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Load event, guest id, already-uploaded count, and any staged photos left
  // over from a previous visit (survives a full browser close, via IndexedDB).
  useEffect(() => {
    let cancelled = false;

    async function load() {
      // guestId only depends on eventId (a local computation), not on the
      // event doc's content — so this and the other two fetches below can
      // all fire at once instead of waiting on each other. Cuts the guest
      // page's initial load from two sequential Firestore round-trips down
      // to one, which matters a lot on a mobile connection where each
      // round-trip (especially Firestore's first-connection handshake) adds
      // real, noticeable delay.
      const gid = getOrCreateGuestId(eventId);

      const [eventSnap, guestSnap, stagedPhotos] = await Promise.all([
        getDoc(doc(db, "events", eventId)),
        getDoc(doc(db, "guests", gid)),
        getStagedPhotos(eventId, gid),
      ]);
      if (cancelled) return;

      if (!eventSnap.exists()) {
        setEvent(null);
        return;
      }
      setEvent(eventSnap.data() as EventDoc);
      setGuestId(gid);

      if (guestSnap.exists()) {
        setAlreadyUploaded((guestSnap.data() as GuestDoc).photosTaken);
      }
      stagedRef.current = stagedPhotos;
      setStaged(stagedPhotos);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  // The event's live phase — recomputed every tick (see the `now` interval
  // above), not just once on load, so the countdown/cutoff actually moves.
  const phase: Phase = useMemo(() => {
    if (event === undefined) return "loading";
    if (event === null) return "not-found";
    if (event.revealed) return "ended";
    // Don't yank the UI to "ended" out from under an in-progress upload —
    // let it finish rather than abandoning a request that's already in flight.
    if (uploading) return now <= event.endsAt ? "open" : "grace";
    if (now < event.startsAt) return "not-started";
    if (now <= event.endsAt) return "open";
    if (now <= event.endsAt + UPLOAD_GRACE_PERIOD_MS && staged.length > 0) return "grace";
    return "ended";
  }, [event, now, uploading, staged.length]);

  const graceSecondsLeft =
    event && phase === "grace"
      ? Math.max(0, Math.ceil((event.endsAt + UPLOAD_GRACE_PERIOD_MS - now) / 1000))
      : 0;

  // Camera only runs while guests can still take NEW photos — not during the
  // grace period, which is for finishing uploads of what's already staged.
  // Requesting a high resolution explicitly matters a lot here — without it,
  // browsers default to a modest preview resolution meant for smooth
  // playback, not anything close to what the camera can actually capture.
  useEffect(() => {
    if (phase !== "open") return;
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
  }, [phase]);

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

  /** The single place staged-list mutations go through — keeps stagedRef,
   * React state, and IndexedDB all consistent, including when called from
   * concurrent upload workers (see the comment on stagedRef above). */
  function applyStagedChange(next: StagedPhoto[]) {
    stagedRef.current = next;
    setStaged(next);
    if (guestId) setStagedPhotos(eventId, guestId, next).catch(() => {});
  }

  async function takePhoto() {
    if (phase !== "open" || !guestId || remaining <= 0 || capturing) return;
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
      applyStagedChange([...stagedRef.current, photo]);
    } catch (err) {
      console.error("Capture failed:", err);
      setErrorMsg("Couldn't capture that shot — try again.");
    } finally {
      setCapturing(false);
    }
  }

  function removeStaged(id: string) {
    applyStagedChange(stagedRef.current.filter((p) => p.id !== id));
  }

  async function uploadOne(photo: StagedPhoto): Promise<
    | { ok: true; photosTaken: number }
    | { ok: false; error: string; reason?: string }
  > {
    async function releaseSlot() {
      try {
        await fetch("/api/upload-release", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId, guestId }),
        });
      } catch {
        // Best-effort — see /api/upload-release's own comment on this.
      }
    }

    const authRes = await fetch("/api/upload-authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId, guestId }),
    });
    const authData = await authRes.json();
    if (!authRes.ok) {
      return { ok: false, error: authData.error ?? "Upload failed", reason: authData.reason };
    }

    const { photoId, upload, photosTaken } = authData;

    // Direct browser → Cloudinary upload. Retried with backoff since this is
    // the one step going over the open internet to a third party, not
    // through our own infra — mobile connections drop or stall mid-request
    // often enough that this matters a lot in practice. Each attempt has its
    // own timeout so a stalled request fails fast and moves on to a retry
    // instead of hanging indefinitely.
    const backoffMs = [0, 1000, 2500, 5000];
    let cloudinaryOk = false;
    for (let attempt = 0; attempt < backoffMs.length && !cloudinaryOk; attempt++) {
      if (backoffMs[attempt] > 0) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs[attempt]));
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CLOUDINARY_UPLOAD_TIMEOUT_MS);
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
          { method: "POST", body: form, signal: controller.signal }
        );
        cloudinaryOk = cloudRes.ok;
      } catch {
        cloudinaryOk = false;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (!cloudinaryOk) {
      await releaseSlot();
      return { ok: false, error: "Upload to storage failed — try again." };
    }

    const confirmRes = await fetch("/api/upload-confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId, guestId, photoId, cloudinaryPublicId: upload.publicId }),
    });
    if (!confirmRes.ok) {
      await releaseSlot();
      return { ok: false, error: "Upload finished but couldn't be saved — try again." };
    }

    return { ok: true, photosTaken };
  }

  async function uploadAll() {
    if (!guestId || stagedRef.current.length === 0 || uploading) return;
    setUploading(true);
    setErrorMsg("");

    const queue = [...stagedRef.current];
    const totalToUpload = queue.length;
    let uploadedCount = 0;
    let stopped = false;
    let firstError = "";
    setUploadProgress({ done: 0, total: totalToUpload });

    // A small worker pool, not one-at-a-time — meaningfully cuts total wait
    // for a guest with several photos queued, without firing an unbounded
    // burst at a possibly-weak mobile connection.
    async function worker() {
      while (!stopped) {
        const photo = queue.shift();
        if (!photo) return;

        const result = await uploadOne(photo);
        if (!result.ok) {
          stopped = true;
          firstError = result.error;
          return;
        }

        uploadedCount++;
        setAlreadyUploaded(result.photosTaken);
        setUploadProgress({ done: uploadedCount, total: totalToUpload });
        applyStagedChange(stagedRef.current.filter((p) => p.id !== photo.id));
      }
    }

    await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, () => worker()));

    if (firstError) setErrorMsg(firstError);
    setUploading(false);
  }

  if (phase === "loading") {
    return <Centered>Loading event…</Centered>;
  }
  if (phase === "not-found") {
    return <Centered>This event doesn&apos;t exist, or the link is wrong.</Centered>;
  }
  if (phase === "not-started" && event) {
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
  if (phase === "ended" && event) {
    return (
      <Centered>
        <div className="glass max-w-sm w-full p-6 flex flex-col gap-2">
          <p className="font-display text-lg font-semibold">{event.name}</p>
          <p>This event has ended.</p>
          {staged.length > 0 && (
            <p className="text-sm text-text-lo">
              {staged.length} photo{staged.length === 1 ? "" : "s"} didn&apos;t
              finish uploading in time and couldn&apos;t be saved.
            </p>
          )}
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
          {phase === "open" && (
            <span className="font-mono-counter text-sm text-flash">
              {Math.max(remaining, 0)} / {cap} left
            </span>
          )}
        </div>

        {phase === "grace" && (
          <div className="rounded-lg bg-white/5 border border-glass-border px-3 py-2 text-center">
            <p className="text-sm text-text-hi">
              Event has ended — finish uploading within{" "}
              <span className="font-mono-counter text-flash">{graceSecondsLeft}s</span>
            </p>
          </div>
        )}

        {phase === "open" && (
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
        )}

        {errorMsg && <p className="text-sm text-center text-flash">{errorMsg}</p>}

        {phase === "open" && (
          <button
            onClick={takePhoto}
            disabled={remaining <= 0 || uploading || capturing}
            className="flash-pulse rounded-full bg-flash text-ink font-semibold py-4 hover:brightness-105 transition disabled:opacity-40"
          >
            {remaining <= 0 ? "No shots left" : capturing ? "Capturing…" : "Take photo"}
          </button>
        )}

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
