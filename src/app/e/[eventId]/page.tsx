"use client";

import { use, useEffect, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { EventDoc } from "@/lib/types";

const GUEST_ID_KEY_PREFIX = "memento_guest_id_";

function getOrCreateGuestId(eventId: string): string {
  const key = GUEST_ID_KEY_PREFIX + eventId;
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

export default function GuestCapturePage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = use(params);

  const [event, setEvent] = useState<EventDoc | null | undefined>(undefined);
  const [guestId, setGuestId] = useState<string | null>(null);
  const [photosTaken, setPhotosTaken] = useState(0);
  const [status, setStatus] = useState<"idle" | "uploading" | "error" | "capped">(
    "idle"
  );
  const [errorMsg, setErrorMsg] = useState("");
  const [flash, setFlash] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Load event config
  useEffect(() => {
    getDoc(doc(db, "events", eventId)).then((snap) => {
      setEvent(snap.exists() ? (snap.data() as EventDoc) : null);
    });
    setGuestId(getOrCreateGuestId(eventId));
  }, [eventId]);

  // Start camera once we know the event exists
  useEffect(() => {
    if (!event) return;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
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
  }, [event]);

  async function takePhoto() {
    if (!event || !guestId || status === "uploading" || status === "capped") return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const imageBase64 = canvas.toDataURL("image/jpeg", 0.85);

    setFlash(true);
    setTimeout(() => setFlash(false), 200);
    setStatus("uploading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/upload-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, guestId, imageBase64 }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 403) {
          setStatus("capped");
          setErrorMsg(data.error);
        } else {
          setStatus("error");
          setErrorMsg(data.error ?? "Upload failed");
        }
        return;
      }
      setPhotosTaken(data.photosTaken);
      setStatus(data.capRemaining <= 0 ? "capped" : "idle");
    } catch {
      setStatus("error");
      setErrorMsg("Network error — try again.");
    }
  }

  if (event === undefined) {
    return <Centered>Loading event…</Centered>;
  }
  if (event === null) {
    return <Centered>This event doesn&apos;t exist, or the link is wrong.</Centered>;
  }
  if (event.revealed) {
    return <Centered>This event has already ended.</Centered>;
  }

  const remaining = event.photoCapPerGuest - photosTaken;

  return (
    <main className="flex-1 flex flex-col items-center justify-center p-4 gap-4">
      <div className="glass w-full max-w-md p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-lg font-semibold">{event.name}</h1>
          <span className="font-mono-counter text-sm text-flash">
            {Math.max(remaining, 0)} / {event.photoCapPerGuest} left
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
          <canvas ref={canvasRef} className="hidden" />
        </div>

        {errorMsg && (
          <p className="text-sm text-center text-flash">{errorMsg}</p>
        )}

        <button
          onClick={takePhoto}
          disabled={status === "uploading" || status === "capped"}
          className="flash-pulse rounded-full bg-flash text-ink font-semibold py-4 hover:brightness-105 transition disabled:opacity-40"
        >
          {status === "uploading"
            ? "Saving…"
            : status === "capped"
            ? "No shots left"
            : "Take photo"}
        </button>

        <p className="text-xs text-text-lo text-center">
          Photos stay hidden until the host reveals the gallery — like a real
          disposable camera.
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
