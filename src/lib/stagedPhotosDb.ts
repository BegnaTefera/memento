// Staged (captured but not yet uploaded) photos live here, keyed by
// eventId+guestId, so a guest can review/remove/retake before committing to
// an upload — and so that work survives closing the browser entirely, not
// just an accidental refresh. IndexedDB (not localStorage) because several
// full-resolution JPEG data URLs can easily exceed localStorage's ~5-10MB
// per-origin quota; IndexedDB's quota is far larger.

const DB_NAME = "memento-staged-photos";
const DB_VERSION = 1;
const STORE_NAME = "staged";

export interface StagedPhoto {
  id: string; // local-only id, distinct from the server photoId assigned on upload
  dataUrl: string;
  capturedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME); // keyed by the eventId+guestId string we pass in
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function key(eventId: string, guestId: string) {
  return `${eventId}:${guestId}`;
}

export async function getStagedPhotos(
  eventId: string,
  guestId: string
): Promise<StagedPhoto[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key(eventId, guestId));
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function setStagedPhotos(
  eventId: string,
  guestId: string,
  photos: StagedPhoto[]
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(photos, key(eventId, guestId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearStagedPhotos(
  eventId: string,
  guestId: string
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key(eventId, guestId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
