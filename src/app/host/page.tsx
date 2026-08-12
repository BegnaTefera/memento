"use client";

import { useEffect, useState } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  type User,
} from "firebase/auth";
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  doc,
  where,
} from "firebase/firestore";
import { QRCodeSVG } from "qrcode.react";
import { auth, db } from "@/lib/firebase";
import type { EventDoc } from "@/lib/types";

export default function HostPage() {
  const [user, setUser] = useState<User | null | undefined>(undefined); // undefined = loading
  const [events, setEvents] = useState<EventDoc[]>([]);
  const [authError, setAuthError] = useState("");

  useEffect(() => onAuthStateChanged(auth, setUser), []);

// Picks up the result after Google redirects back to this page post-sign-in.
// Wrapped so it can be called again below, not just on the initial mount.
useEffect(() => {
  function checkRedirectResult() {
    getRedirectResult(auth).catch((err) => {
      console.error("Sign-in redirect error:", err);
      setAuthError("Sign-in failed — please try again.");
    });
  }

  checkRedirectResult();

  // Chrome (and some other browsers) can restore this exact page from the
  // back/forward cache after the Google redirect completes, instead of
  // doing a fresh page load — which means the effect above never re-runs,
  // and the app never learns the sign-in actually succeeded. "pageshow"
  // with event.persisted === true is how a bfcache restore is detected;
  // re-checking here catches that case.
  function handlePageShow(event: PageTransitionEvent) {
    if (event.persisted) {
      checkRedirectResult();
    }
  }
  window.addEventListener("pageshow", handlePageShow);
  return () => window.removeEventListener("pageshow", handlePageShow);
}, []);

  useEffect(() => {
    if (!user) {
      setEvents([]);
      return;
    }
    const q = query(
      collection(db, "events"),
      where("hostUid", "==", user.uid),
      orderBy("createdAt", "desc")
    );
    return onSnapshot(q, (snap) => {
      setEvents(snap.docs.map((d) => d.data() as EventDoc));
    });
  }, [user]);

  if (user === undefined) {
    return <CenteredMessage>Loading…</CenteredMessage>;
  }

  if (user === null) {
    return (
      <CenteredMessage>
        <div className="glass max-w-sm w-full p-8 flex flex-col gap-4 text-center">
          <h1 className="font-display text-2xl font-bold">Host sign-in</h1>
          <p className="text-text-lo text-sm">
            Sign in to create and manage your events.
          </p>
          {authError && (
            <p className="text-flash text-sm">{authError}</p>
          )}
          <button
            onClick={async () => {
              try {
                await signInWithPopup(auth, new GoogleAuthProvider());
              } catch (error) {
                console.warn("Popup failed, falling back to redirect:", error);
                await signInWithRedirect(auth, new GoogleAuthProvider());
              }
            }}
            className="rounded-full bg-flash text-ink font-semibold py-3 px-6 hover:brightness-105 transition"
          >
            Sign in with Google
          </button>
        </div>
      </CenteredMessage>
    );
  }

  return (
    <main className="flex-1 p-6 flex flex-col items-center gap-8">
      <div className="w-full max-w-2xl flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold">Your events</h1>
        <button
          onClick={() => signOut(auth)}
          className="text-sm text-text-lo hover:text-text-hi transition"
        >
          Sign out
        </button>
      </div>

      <CreateEventForm hostUid={user.uid} />

      <div className="w-full max-w-2xl flex flex-col gap-4">
        {events.length === 0 && (
          <p className="text-text-lo text-center">
            No events yet — create one above.
          </p>
        )}
        {events.map((event) => (
          <EventCard key={event.id} event={event} />
        ))}
      </div>
    </main>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex-1 flex items-center justify-center p-6">
      {children}
    </main>
  );
}

function CreateEventForm({ hostUid }: { hostUid: string }) {
  const [name, setName] = useState("");
  const [cap, setCap] = useState(10);
  const [revealMode, setRevealMode] = useState<"immediate" | "delayed">(
    "delayed"
  );
  const [revealAt, setRevealAt] = useState(""); // datetime-local string
  const [galleryMode, setGalleryMode] = useState<"shared" | "private">(
    "shared"
  );
  const [telegramChatId, setTelegramChatId] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const docRef = await addDoc(collection(db, "events"), {
        name: name.trim(),
        hostUid,
        photoCapPerGuest: cap,
        revealMode,
        revealAt: revealMode === "delayed" && revealAt ? new Date(revealAt).getTime() : null,
        revealed: false,
        galleryMode,
        telegramChatId: telegramChatId.trim() || null,
        createdAt: Date.now(),
      });
      // Store the event's own id on itself so it's easy to reference client-side.
      await updateDoc(doc(db, "events", docRef.id), { id: docRef.id });
      setName("");
      setTelegramChatId("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="glass w-full max-w-2xl p-6 flex flex-col gap-4"
    >
      <h2 className="font-display text-lg font-semibold">Create an event</h2>

      <Field label="Event name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Sara & Dan's wedding"
          className="input"
          required
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Photos per guest">
          <input
            type="number"
            min={1}
            value={cap}
            onChange={(e) => setCap(Number(e.target.value))}
            className="input font-mono-counter"
          />
        </Field>

        <Field label="Gallery">
          <select
            value={galleryMode}
            onChange={(e) => setGalleryMode(e.target.value as "shared" | "private")}
            className="input"
          >
            <option value="shared">Shared with guests</option>
            <option value="private">Private to host</option>
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Reveal">
          <select
            value={revealMode}
            onChange={(e) =>
              setRevealMode(e.target.value as "immediate" | "delayed")
            }
            className="input"
          >
            <option value="delayed">At a scheduled time</option>
            <option value="immediate">Immediately after upload</option>
          </select>
        </Field>

        {revealMode === "delayed" && (
          <Field label="Reveal at">
            <input
              type="datetime-local"
              value={revealAt}
              onChange={(e) => setRevealAt(e.target.value)}
              className="input"
              required
            />
          </Field>
        )}
      </div>

      <Field label="Telegram chat ID (optional)">
        <input
          value={telegramChatId}
          onChange={(e) => setTelegramChatId(e.target.value)}
          placeholder="-1001234567890"
          className="input font-mono-counter"
        />
      </Field>
      <p className="text-xs text-text-lo -mt-2">
        Add the bot as admin to your channel, then paste its chat ID here —
        the reveal album posts there automatically.
      </p>

      <button
        type="submit"
        disabled={saving}
        className="flash-pulse rounded-full bg-flash text-ink font-semibold py-3 px-6 hover:brightness-105 transition disabled:opacity-50"
      >
        {saving ? "Creating…" : "Create event"}
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="text-text-lo">{label}</span>
      {children}
    </label>
  );
}

function EventCard({ event }: { event: EventDoc }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  const guestUrl = origin ? `${origin}/e/${event.id}` : "";

  return (
    <div className="glass p-6 flex flex-col md:flex-row gap-6">
      <div className="flex-1 flex flex-col gap-2">
        <h3 className="font-display text-lg font-semibold">{event.name}</h3>
        <dl className="text-sm text-text-lo grid grid-cols-2 gap-x-4 gap-y-1">
          <dt>Cap per guest</dt>
          <dd className="font-mono-counter text-text-hi">
            {event.photoCapPerGuest}
          </dd>
          <dt>Gallery</dt>
          <dd className="text-text-hi capitalize">{event.galleryMode}</dd>
          <dt>Reveal</dt>
          <dd className="text-text-hi">
            {event.revealMode === "immediate"
              ? "Immediate"
              : event.revealAt
              ? new Date(event.revealAt).toLocaleString()
              : "Not set"}
          </dd>
          <dt>Status</dt>
          <dd className="text-text-hi">
            {event.revealed ? "🎉 Revealed" : "⏳ Locked"}
          </dd>
        </dl>
        {guestUrl && (
          <a
            href={guestUrl}
            target="_blank"
            rel="noreferrer"
            className="text-flash text-sm underline underline-offset-2 mt-2"
          >
            {guestUrl}
          </a>
        )}
      </div>
      {guestUrl && (
        <div className="bg-white p-3 rounded-lg self-start">
          <QRCodeSVG value={guestUrl} size={120} />
        </div>
      )}
    </div>
  );
}