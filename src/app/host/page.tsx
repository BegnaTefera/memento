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
  getDoc,
  setDoc,
  where,
} from "firebase/firestore";
import { AnimatePresence, motion } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { Camera, ChevronDown, Pencil, QrCode, Trash2, Zap } from "lucide-react";
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

function compactDateRange(startsAt: number, endsAt: number): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  return `${new Date(startsAt).toLocaleString(undefined, opts)} – ${new Date(endsAt).toLocaleString(undefined, opts)}`;
}

export default function HostPage() {
  const [user, setUser] = useState<User | null | undefined>(undefined); // undefined = loading
  const [events, setEvents] = useState<EventDoc[]>([]);
  const [authError, setAuthError] = useState("");
  const [recentChatIds, setRecentChatIds] = useState<string[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(true);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    function checkRedirectResult() {
      getRedirectResult(auth).catch((err) => {
        console.error("Sign-in redirect error:", err);
        setAuthError("Sign-in failed — please try again.");
      });
    }
    checkRedirectResult();
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) checkRedirectResult();
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

  useEffect(() => {
    if (!user) {
      setRecentChatIds([]);
      return;
    }
    getDoc(doc(db, "hostSettings", user.uid)).then((snap) => {
      if (snap.exists()) {
        setRecentChatIds((snap.data().recentTelegramChatIds as string[]) ?? []);
      }
    });
  }, [user]);

  async function rememberChatId(chatId: string) {
    if (!user || !chatId.trim()) return;
    const trimmed = chatId.trim();
    const next = [trimmed, ...recentChatIds.filter((id) => id !== trimmed)].slice(0, 5);
    setRecentChatIds(next);
    try {
      await setDoc(doc(db, "hostSettings", user.uid), { recentTelegramChatIds: next }, { merge: true });
    } catch (err) {
      console.error("Failed to save recent chat id:", err);
    }
  }

  if (user === undefined) {
    return <CenteredMessage>Loading…</CenteredMessage>;
  }

  if (user === null) {
    return (
      <CenteredMessage>
        <div className="sheet max-w-sm w-full p-8 flex flex-col gap-4 text-center">
          <h1 className="font-display text-2xl font-semibold">Host sign-in</h1>
          <p className="text-text-lo text-sm">Sign in to create and manage your events.</p>
          {authError && <p className="text-danger text-sm">{authError}</p>}
          <button
            data-cursor-hover
            onClick={async () => {
              try {
                await signInWithPopup(auth, new GoogleAuthProvider());
              } catch (error) {
                console.warn("Popup failed, falling back to redirect:", error);
                await signInWithRedirect(auth, new GoogleAuthProvider());
              }
            }}
            className="btn btn-primary"
          >
            Sign in with Google
          </button>
        </div>
      </CenteredMessage>
    );
  }

  return (
    <main className="flex-1 p-6 flex flex-col items-center gap-6">
      <div className="w-full max-w-2xl flex items-center justify-between">
        <span className="font-display text-xl font-semibold text-text-hi">Memento</span>
        <button data-cursor-hover onClick={() => signOut(auth)} className="text-sm text-text-lo hover:text-text-hi transition">
          Sign out
        </button>
      </div>

      <div className="w-full max-w-2xl flex items-center justify-between">
        <h1 className="font-display text-xl font-semibold">Your events</h1>
        <button
          data-cursor-hover
          onClick={() => setShowCreateForm((s) => !s)}
          className="text-sm font-medium text-accent hover:brightness-110 transition"
        >
          {showCreateForm ? "Hide form" : "+ New event"}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {showCreateForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="w-full max-w-2xl overflow-hidden"
          >
            <CreateEventForm
              hostUid={user.uid}
              recentChatIds={recentChatIds}
              onChatIdUsed={rememberChatId}
              onCreated={() => setShowCreateForm(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="w-full max-w-2xl flex flex-col gap-2">
        {events.length === 0 && (
          <p className="text-text-lo text-center text-sm py-4">No events yet — create one above.</p>
        )}
        {events.map((event) => (
          <EventRow
            key={event.id}
            event={event}
            user={user}
            recentChatIds={recentChatIds}
            onChatIdUsed={rememberChatId}
          />
        ))}
      </div>
    </main>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return <main className="flex-1 flex items-center justify-center p-6">{children}</main>;
}

interface EventFormValues {
  name: string;
  cap: number;
  maxTotalPhotos: number;
  startsAt: string;
  endsAt: string;
  revealMode: "immediate" | "delayed";
  revealAt: string;
  galleryMode: "shared" | "private";
  telegramChatId: string;
}

/** A section label within the flowing form — muted, uppercase, no box
 * around it. Sections are separated by a divider, not a bordered card. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wide text-text-lo pt-1">
      {children}
    </p>
  );
}

function EventFormFields({
  values,
  onChange,
  recentChatIds = [],
}: {
  values: EventFormValues;
  onChange: (next: EventFormValues) => void;
  recentChatIds?: string[];
}) {
  return (
    <>
      <SectionLabel>The basics</SectionLabel>
      <Field label="Event name">
        <input
          value={values.name}
          onChange={(e) => onChange({ ...values, name: e.target.value })}
          placeholder="Sara & Dan's wedding"
          className="input"
          required
        />
      </Field>

      <div className="border-t border-border" />
      <SectionLabel>Limits</SectionLabel>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Photos per guest">
          <input
            type="number"
            min={1}
            value={values.cap}
            onChange={(e) => onChange({ ...values, cap: Number(e.target.value) })}
            className="input"
          />
        </Field>
        <Field label="Total photo limit">
          <input
            type="number"
            min={1}
            value={values.maxTotalPhotos}
            onChange={(e) => onChange({ ...values, maxTotalPhotos: Number(e.target.value) })}
            className="input"
          />
        </Field>
      </div>
      <p className="text-xs text-text-lo -mt-2">
        Total limit is a hard ceiling across every guest combined — protects your
        storage quota even if the link gets shared further than you expected.
      </p>

      <div className="border-t border-border" />
      <SectionLabel>Timing</SectionLabel>
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
      <p className="text-xs text-text-lo -mt-2">The guest link only works between these two times.</p>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Reveal">
          <select
            value={values.revealMode}
            onChange={(e) => onChange({ ...values, revealMode: e.target.value as "immediate" | "delayed" })}
            className="input"
          >
            <option value="delayed">At a scheduled time</option>
            <option value="immediate">Immediately after upload</option>
          </select>
        </Field>
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
      </div>

      <div className="border-t border-border" />
      <SectionLabel>Sharing</SectionLabel>
      <Field label="Gallery">
        <select
          value={values.galleryMode}
          onChange={(e) => onChange({ ...values, galleryMode: e.target.value as "shared" | "private" })}
          className="input"
        >
          <option value="shared">Shared with guests</option>
          <option value="private">Private to host</option>
        </select>
      </Field>

      <Field label="Telegram chat ID (optional)">
        <input
          value={values.telegramChatId}
          onChange={(e) => onChange({ ...values, telegramChatId: e.target.value })}
          placeholder="-1001234567890"
          className="input"
        />
      </Field>
      {recentChatIds.length > 0 && (
        <div className="flex flex-wrap gap-2 -mt-2">
          {recentChatIds.map((id) => (
            <button
              key={id}
              type="button"
              data-cursor-hover
              onClick={() => onChange({ ...values, telegramChatId: id })}
              className="text-xs px-2.5 py-1 rounded-full border border-border text-text-lo hover:text-text-hi hover:bg-white/5 transition"
            >
              {id}
            </button>
          ))}
        </div>
      )}
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

function CreateEventForm({
  hostUid,
  recentChatIds,
  onChatIdUsed,
  onCreated,
}: {
  hostUid: string;
  recentChatIds: string[];
  onChatIdUsed: (chatId: string) => void;
  onCreated: () => void;
}) {
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
      await updateDoc(doc(db, "events", docRef.id), { id: docRef.id });
      if (values.telegramChatId.trim()) onChatIdUsed(values.telegramChatId);
      setValues(DEFAULT_FORM_VALUES);
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="sheet p-6 flex flex-col gap-4">
      <EventFormFields values={values} onChange={setValues} recentChatIds={recentChatIds} />
      <button type="submit" data-cursor-hover disabled={saving} className="btn btn-primary mt-2 disabled:opacity-50">
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

function statusFor(event: EventDoc): { label: string; dot: string } {
  const now = Date.now();
  if (event.revealed) return { label: "Revealed", dot: "bg-accent" };
  if (now < event.startsAt) return { label: "Not started", dot: "bg-text-lo" };
  if (now > event.endsAt) return { label: "Ended", dot: "bg-danger" };
  return { label: "Live", dot: "bg-accent" };
}

/** Compact by default: an icon avatar, name, status subtitle, and a row
 * of always-visible icon actions — matching a familiar "list of items
 * with inline actions" pattern instead of an always-open detail panel.
 * QR code and full stats live behind the chevron, since they don't fit
 * inline without cluttering the row. */
function EventRow({
  event,
  user,
  recentChatIds,
  onChatIdUsed,
}: {
  event: EventDoc;
  user: User;
  recentChatIds: string[];
  onChatIdUsed: (chatId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [origin, setOrigin] = useState("");
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
  const status = statusFor(event);

  async function handleSave() {
    setBusy("save");
    setActionError("");
    try {
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
      if (editValues.telegramChatId.trim()) onChatIdUsed(editValues.telegramChatId);
      setEditing(false);
    } catch (err) {
      console.error("Save failed:", err);
      setActionError("Failed to save changes.");
    } finally {
      setBusy(null);
    }
  }

  async function handleRevealNow() {
    if (!confirm(`Reveal "${event.name}" now? This posts to Telegram immediately.`)) return;
    setBusy("reveal");
    setActionError("");
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/reveal-now", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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
    if (!confirm(`Delete "${event.name}" permanently? This removes all its photos too — can't be undone.`)) return;
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
    } catch (err) {
      console.error("Delete failed:", err);
      setActionError("Delete failed — try again.");
      setBusy(null);
    }
  }

  return (
    <div className="sheet overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="avatar-icon bg-surface-2 text-text-lo">
          <Camera size={18} />
        </span>
        <button
          data-cursor-hover
          onClick={() => setExpanded((s) => !s)}
          className="flex-1 min-w-0 flex items-center gap-3 text-left"
        >
          <div className="flex-1 min-w-0">
            <p className="font-display font-semibold text-text-hi truncate">{event.name}</p>
            <p className="text-xs text-text-lo truncate flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} aria-hidden="true" />
              {compactDateRange(event.startsAt, event.endsAt)} · {status.label}
            </p>
          </div>
        </button>

        <button data-cursor-hover onClick={() => setEditing(true)} className="btn-icon" aria-label="Edit event">
          <Pencil size={15} />
        </button>
        {!event.revealed && (
          <button data-cursor-hover onClick={handleRevealNow} disabled={busy !== null} className="btn-icon" aria-label="Reveal now">
            <Zap size={15} />
          </button>
        )}
        <button data-cursor-hover onClick={() => setExpanded((s) => !s)} className="btn-icon" aria-label="Show QR code">
          <QrCode size={15} />
        </button>
        <button
          data-cursor-hover
          onClick={handleDelete}
          disabled={busy !== null}
          className="btn-icon btn-icon-danger"
          aria-label="Delete event"
        >
          <Trash2 size={15} />
        </button>
        <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }} className="text-text-lo">
          <ChevronDown size={16} />
        </motion.span>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="overflow-hidden border-t border-border"
          >
            {editing ? (
              <div className="p-4 flex flex-col gap-3">
                <EventFormFields values={editValues} onChange={setEditValues} recentChatIds={recentChatIds} />
                {actionError && <p className="text-danger text-sm">{actionError}</p>}
                <div className="flex gap-3">
                  <button data-cursor-hover onClick={handleSave} disabled={busy === "save"} className="btn btn-primary flex-1 disabled:opacity-50">
                    {busy === "save" ? "Saving…" : "Save changes"}
                  </button>
                  <button data-cursor-hover onClick={() => setEditing(false)} className="btn btn-secondary flex-1">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4 flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="flex-1">
                    <div className="list-row">
                      <span className="text-text-lo text-sm">Cap per guest</span>
                      <span className="text-text-hi text-sm">{event.photoCapPerGuest}</span>
                    </div>
                    <div className="list-row">
                      <span className="text-text-lo text-sm">Total photos</span>
                      <span className="text-text-hi text-sm">{event.totalPhotos ?? 0} / {event.maxTotalPhotos}</span>
                    </div>
                    <div className="list-row">
                      <span className="text-text-lo text-sm">Gallery</span>
                      <span className="text-text-hi text-sm capitalize">{event.galleryMode}</span>
                    </div>
                    <div className="list-row">
                      <span className="text-text-lo text-sm">Reveal</span>
                      <span className="text-text-hi text-sm">
                        {event.revealMode === "immediate"
                          ? "Immediate"
                          : event.revealAt
                          ? new Date(event.revealAt).toLocaleString()
                          : "Not set"}
                      </span>
                    </div>
                  </div>
                  {guestUrl && (
                    <div className="bg-white p-2.5 rounded-xl self-start shrink-0">
                      <QRCodeSVG value={guestUrl} size={96} />
                    </div>
                  )}
                </div>
                {guestUrl && (
                  <a href={guestUrl} target="_blank" rel="noreferrer" className="text-accent text-sm underline underline-offset-2 break-all">
                    {guestUrl}
                  </a>
                )}
                {actionError && <p className="text-danger text-sm">{actionError}</p>}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
