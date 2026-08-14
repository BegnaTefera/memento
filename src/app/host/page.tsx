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

// datetime-local inputs need "YYYY-MM-DDTHH:mm" in LOCAL time, not ISO/UTC.
function toDatetimeLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

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
          {authError && <p className="text-flash text-sm">{authError}</p>}
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
          <EventCard key={event.id} event={event} user={user} />
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

// Shared shape for both the create form and the edit form below, so the
// two don't drift out of sync with each other.
interface EventFormValues {
  name: string;
  cap: number;
  maxTotalPhotos: number;
  startsAt: string; // datetime-local string
  endsAt: string; // datetime-local string
  revealMode: "immediate" | "delayed";
  revealAt: string; // datetime-local string
  galleryMode: "shared" | "private";
  telegramChatId: string;
}

function EventFormFields({
  values,
  onChange,
}: {
  values: EventFormValues;
  onChange: (next: EventFormValues) => void;
}) {
  return (
    <>
      <Field label="Event name">
        <input
          value={values.name}
          onChange={(e) => onChange({ ...values, name: e.target.value })}
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
            value={values.cap}
            onChange={(e) => onChange({ ...values, cap: Number(e.target.value) })}
            className="input font-mono-counter"
          />
        </Field>

        <Field label="Total photo limit">
          <input
            type="number"
            min={1}
            value={values.maxTotalPhotos}
            onChange={(e) =>
              onChange({ ...values, maxTotalPhotos: Number(e.target.value) })
            }
            className="input font-mono-counter"
          />
        </Field>
      </div>
      <p className="text-xs text-text-lo -mt-2">
        Total photo limit is a hard ceiling across every guest combined —
        protects your storage quota even if the link gets shared beyond who
        you expected.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Event starts">
          <input
            type="datetime-local"
            value={values.startsAt}
            onChange={(e) => onChange({ ...values, startsAt: e.target.value })}
            className="input"
            required
          />
        </Field>
        <Field label="Event ends">
          <input
            type="datetime-local"
            value={values.endsAt}
            onChange={(e) => onChange({ ...values, endsAt: e.target.value })}
            className="input"
            required
          />
        </Field>
      </div>
      <p className="text-xs text-text-lo -mt-2">
        The guest link only works between these two times.
      </p>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Gallery">
          <select
            value={values.galleryMode}
            onChange={(e) =>
              onChange({ ...values, galleryMode: e.target.value as "shared" | "private" })
            }
            className="input"
          >
            <option value="shared">Shared with guests</option>
            <option value="private">Private to host</option>
          </select>
        </Field>

        <Field label="Reveal">
          <select
            value={values.revealMode}
            onChange={(e) =>
              onChange({ ...values, revealMode: e.target.value as "immediate" | "delayed" })
            }
            className="input"
          >
            <option value="delayed">At a scheduled time</option>
            <option value="immediate">Immediately after upload</option>
          </select>
        </Field>
      </div>

      {values.revealMode === "delayed" && (
        <Field label="Reveal at">
          <input
            type="datetime-local"
            value={values.revealAt}
            onChange={(e) => onChange({ ...values, revealAt: e.target.value })}
            className="input"
            required
          />
        </Field>
      )}

      <Field label="Telegram chat ID (optional)">
        <input
          value={values.telegramChatId}
          onChange={(e) => onChange({ ...values, telegramChatId: e.target.value })}
          placeholder="-1001234567890"
          className="input font-mono-counter"
        />
      </Field>
    </>
  );
}

const DEFAULT_FORM_VALUES: EventFormValues = {
  name: "",
  cap: 10,
  maxTotalPhotos: 200,
  startsAt: "",
  endsAt: "",
  revealMode: "delayed",
  revealAt: "",
  galleryMode: "shared",
  telegramChatId: "",
};

function CreateEventForm({ hostUid }: { hostUid: string }) {
  const [values, setValues] = useState<EventFormValues>(DEFAULT_FORM_VALUES);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!values.name.trim() || !values.startsAt || !values.endsAt) return;
    setSaving(true);
    try {
      const docRef = await addDoc(collection(db, "events"), {
        name: values.name.trim(),
        hostUid,
        photoCapPerGuest: values.cap,
        maxTotalPhotos: values.maxTotalPhotos,
        totalPhotos: 0,
        startsAt: new Date(values.startsAt).getTime(),
        endsAt: new Date(values.endsAt).getTime(),
        revealMode: values.revealMode,
        revealAt:
          values.revealMode === "delayed" && values.revealAt
            ? new Date(values.revealAt).getTime()
            : null,
        revealed: false,
        galleryMode: values.galleryMode,
        telegramChatId: values.telegramChatId.trim() || null,
        createdAt: Date.now(),
      });
      // Store the event's own id on itself so it's easy to reference client-side.
      await updateDoc(doc(db, "events", docRef.id), { id: docRef.id });
      setValues(DEFAULT_FORM_VALUES);
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
      <EventFormFields values={values} onChange={setValues} />
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

function EventCard({ event, user }: { event: EventDoc; user: User }) {
  const [origin, setOrigin] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"reveal" | "delete" | "save" | null>(null);
  const [actionError, setActionError] = useState("");
  const [editValues, setEditValues] = useState<EventFormValues>(() => ({
    name: event.name,
    cap: event.photoCapPerGuest,
    maxTotalPhotos: event.maxTotalPhotos,
    startsAt: toDatetimeLocal(event.startsAt),
    endsAt: toDatetimeLocal(event.endsAt),
    revealMode: event.revealMode,
    revealAt: event.revealAt ? toDatetimeLocal(event.revealAt) : "",
    galleryMode: event.galleryMode,
    telegramChatId: event.telegramChatId ?? "",
  }));

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  const guestUrl = origin ? `${origin}/e/${event.id}` : "";

  async function handleSave() {
    setBusy("save");
    setActionError("");
    try {
      // Direct client-side Firestore write — Firestore rules already allow a
      // host to update their own event doc, so no API route needed here
      // (unlike delete, which also has to clean up Cloudinary storage).
      await updateDoc(doc(db, "events", event.id), {
        name: editValues.name.trim(),
        photoCapPerGuest: editValues.cap,
        maxTotalPhotos: editValues.maxTotalPhotos,
        startsAt: new Date(editValues.startsAt).getTime(),
        endsAt: new Date(editValues.endsAt).getTime(),
        revealMode: editValues.revealMode,
        revealAt:
          editValues.revealMode === "delayed" && editValues.revealAt
            ? new Date(editValues.revealAt).getTime()
            : null,
        galleryMode: editValues.galleryMode,
        telegramChatId: editValues.telegramChatId.trim() || null,
      });
      setEditing(false);
    } catch (err) {
      console.error("Save failed:", err);
      setActionError("Failed to save changes.");
    } finally {
      setBusy(null);
    }
  }

  async function handleRevealNow() {
    if (!confirm(`Reveal "${event.name}" now? This posts to Telegram immediately.`)) {
      return;
    }
    setBusy("reveal");
    setActionError("");
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/reveal-now", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ eventId: event.id }),
      });
      if (!res.ok) {
        const data = await res.json();
        setActionError(data.error ?? "Reveal failed");
      }
    } catch (err) {
      console.error("Reveal failed:", err);
      setActionError("Reveal failed — try again.");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (
      !confirm(
        `Delete "${event.name}" permanently? This removes all its photos too — can't be undone.`
      )
    ) {
      return;
    }
    setBusy("delete");
    setActionError("");
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/events/${event.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json();
        setActionError(data.error ?? "Delete failed");
        setBusy(null);
      }
      // On success the event doc is gone, so the onSnapshot listener up in
      // HostPage removes this card automatically — no local state to clear.
    } catch (err) {
      console.error("Delete failed:", err);
      setActionError("Delete failed — try again.");
      setBusy(null);
    }
  }

  if (editing) {
    return (
      <div className="glass p-6 flex flex-col gap-4">
        <h3 className="font-display text-lg font-semibold">Edit event</h3>
        <EventFormFields values={editValues} onChange={setEditValues} />
        {actionError && <p className="text-flash text-sm">{actionError}</p>}
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            disabled={busy === "save"}
            className="flex-1 rounded-full bg-flash text-ink font-semibold py-2.5 hover:brightness-105 transition disabled:opacity-50"
          >
            {busy === "save" ? "Saving…" : "Save changes"}
          </button>
          <button
            onClick={() => setEditing(false)}
            className="flex-1 rounded-full border border-glass-border text-text-hi font-semibold py-2.5 hover:bg-white/5 transition"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="glass p-6 flex flex-col gap-4">
      <div className="flex flex-col md:flex-row gap-6">
        <div className="flex-1 flex flex-col gap-2">
          <h3 className="font-display text-lg font-semibold">{event.name}</h3>
          <dl className="text-sm text-text-lo grid grid-cols-2 gap-x-4 gap-y-1">
            <dt>Cap per guest</dt>
            <dd className="font-mono-counter text-text-hi">
              {event.photoCapPerGuest}
            </dd>
            <dt>Total photos</dt>
            <dd className="font-mono-counter text-text-hi">
              {event.totalPhotos ?? 0} / {event.maxTotalPhotos}
            </dd>
            <dt>Window</dt>
            <dd className="text-text-hi">
              {new Date(event.startsAt).toLocaleString()} –{" "}
              {new Date(event.endsAt).toLocaleString()}
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

      {actionError && <p className="text-flash text-sm">{actionError}</p>}

      <div className="flex flex-wrap gap-3 pt-2 border-t border-glass-border">
        <button
          onClick={() => setEditing(true)}
          disabled={busy !== null}
          className="text-sm text-text-hi hover:text-flash transition disabled:opacity-40"
        >
          Edit
        </button>
        {!event.revealed && (
          <button
            onClick={handleRevealNow}
            disabled={busy !== null}
            className="text-sm text-text-hi hover:text-flash transition disabled:opacity-40"
          >
            {busy === "reveal" ? "Revealing…" : "Reveal now"}
          </button>
        )}
        <button
          onClick={handleDelete}
          disabled={busy !== null}
          className="text-sm text-text-lo hover:text-flash transition disabled:opacity-40 ml-auto"
        >
          {busy === "delete" ? "Deleting…" : "Delete"}
        </button>
      </div>
    </div>
  );
}
