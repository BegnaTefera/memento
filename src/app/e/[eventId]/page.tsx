"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { doc, getDoc } from "firebase/firestore";
import { CalendarClock, CalendarX, X, Images } from "lucide-react";
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

/** Matches the reference app's "Ends Sat at 11:59PM" style, computed from
 * the event's real end time rather than hardcoded. */
function formatEndsAt(ms: number): string {
  const d = new Date(ms);
  const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `Ends ${weekday} at ${time}`;
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
  const [showGallery, setShowGallery] = useState(false);

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
        <div className="sheet w-full max-w-sm overflow-hidden">
          <div className="h-1 bg-accent" />
          <div className="flex flex-col items-center gap-5 p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-accent-dim bg-accent/10 text-accent">
              <CalendarClock size={26} strokeWidth={1.8} />
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-text-lo">
                Coming up
              </p>
              <h1 className="font-display text-2xl font-semibold leading-tight text-text-hi">
                {event.name}
              </h1>
            </div>
            <div className="w-full border-t border-border" />
            <div className="flex flex-col gap-1">
              <p className="text-text-hi">This event hasn&apos;t started yet.</p>
              <p className="text-sm text-text-lo">
                Starts {new Date(event.startsAt).toLocaleString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>
        </div>
      </Centered>
    );
  }
  if (phase === "ended" && event) {
    return (
      <Centered>
        <div className="sheet w-full max-w-sm overflow-hidden">
          <div className="h-1 bg-accent" />
          <div className="flex flex-col items-center gap-5 p-8 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-surface-2 text-text-lo">
              <CalendarX size={26} strokeWidth={1.8} />
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-text-lo">
                Event complete
              </p>
              <h1 className="font-display text-2xl font-semibold leading-tight text-text-hi">
                {event.name}
              </h1>
            </div>
            <div className="w-full border-t border-border" />
            <div className="flex flex-col gap-2">
              <p className="text-text-hi">This event has ended.</p>
              {staged.length > 0 && (
                <p className="text-sm text-text-lo">
                  {staged.length} photo{staged.length === 1 ? "" : "s"} didn&apos;t
                  finish uploading in time and couldn&apos;t be saved.
                </p>
              )}
            </div>
          </div>
        </div>
      </Centered>
    );
  }
  if (!event) {
    return <Centered>Loading event…</Centered>;
  }

  return (
    <main className="flex-1 flex items-center justify-center bg-ink p-0 text-text-hi">
      <div className="relative h-dvh w-full max-w-[480px] overflow-hidden bg-ink text-text-hi">
        {/* Header — safe-area aware so it clears a notch/status bar on
            full-bleed mobile browsers. */}
        <div
          className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-4"
          style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}
        >
          <Link
            href="/"
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-text-hi"
          >
            <X size={20} />
          </Link>

          <div className="flex-1 text-center px-2">
            <h1 className="font-display text-2xl font-semibold leading-none truncate">
              {event.name}
            </h1>
            {phase === "open" && (
              <p className="mt-1 text-xs text-text-lo">{formatEndsAt(event.endsAt)}</p>
            )}
            {phase === "grace" && (
              <p className="mt-1 text-xs text-text-lo">
                Finish uploads in <span className="font-display text-accent">{graceSecondsLeft}s</span>
              </p>
            )}
          </div>

          {/* Spacer matching the close button's width, so the title stays
              visually centered without a fake/non-functional control on this side. */}
          <div className="h-11 w-11 shrink-0" aria-hidden="true" />
        </div>

        {phase === "open" && (
          <div className="absolute inset-0 z-10">
            <div className="relative h-full w-full overflow-hidden bg-black">
              <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
            </div>
            {flash && <div className="absolute inset-0 z-30 bg-white animate-[flash-pulse_0.2s_ease-out]" />}
          </div>
        )}

        {/* Bottom controls — safe-area aware for the home-indicator area. */}
        <div
          className="absolute inset-x-0 bottom-0 z-20 px-4"
          style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-end justify-between gap-3">
            <div className="flex flex-col items-start justify-end pb-2 w-16">
              {phase === "open" && (
                <>
                  <span className="font-display text-4xl font-semibold leading-none text-text-hi">
                    {Math.max(remaining, 0)}
                  </span>
                  <span className="mt-1 text-[10px] uppercase tracking-wide text-text-lo">shots left</span>
                </>
              )}
            </div>

            {phase === "open" && (
              <button
                type="button"
                onClick={takePhoto}
                disabled={remaining <= 0 || uploading || capturing}
                className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white/70 bg-white/10 transition hover:brightness-105 disabled:opacity-50 shrink-0"
                aria-label="Take photo"
              >
                <span className="h-14 w-14 rounded-full bg-white" />
              </button>
            )}

            <div className="flex items-end justify-end pb-2 w-16">
              {staged.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowGallery((s) => !s)}
                  className="relative flex h-11 w-11 items-center justify-center rounded-full border border-border bg-surface text-text-hi"
                  aria-label={`Open gallery, ${staged.length} photo${staged.length === 1 ? "" : "s"} waiting to upload`}
                >
                  <Images size={18} />
                  <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-ink">
                    {staged.length}
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>

        {errorMsg && (
          <div className="absolute inset-x-0 top-24 z-30 px-4">
            <p className="rounded-full border border-danger/30 bg-danger/15 px-3 py-2 text-center text-sm text-text-hi">
              {errorMsg}
            </p>
          </div>
        )}

        {phase === "grace" && (
          <div className="absolute inset-x-0 top-24 z-30 px-4">
            <div className="sheet px-3 py-2 text-center">
              <p className="text-sm text-text-lo">
                Event has ended — finish uploading within{" "}
                <span className="font-display text-accent">{graceSecondsLeft}s</span>
              </p>
            </div>
          </div>
        )}

        {showGallery && staged.length > 0 && (
          <div
            className="absolute inset-x-0 bottom-0 z-30 px-4"
            style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          >
            <div className="sheet p-3">
              <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-text-lo">
                <span>Gallery</span>
                <button type="button" onClick={() => setShowGallery(false)} className="text-text-hi">
                  Close
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {staged.map((photo) => (
                  <div key={photo.id} className="relative aspect-square overflow-hidden rounded-xl border border-border bg-surface-2">
                    {thumbUrls[photo.id] && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumbUrls[photo.id]}
                        alt="Captured shot, not yet uploaded"
                        className="h-full w-full object-cover"
                      />
                    )}
                    <button
                      onClick={() => removeStaged(photo.id)}
                      disabled={uploading}
                      aria-label="Remove photo"
                      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-xs text-text-hi disabled:opacity-40"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              <button type="button" onClick={uploadAll} disabled={uploading} className="btn btn-primary mt-3 w-full">
                {uploading
                  ? `Uploading ${uploadProgress.done}/${uploadProgress.total}…`
                  : `Upload ${staged.length} photo${staged.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        )}
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
