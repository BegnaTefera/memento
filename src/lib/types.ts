// Firestore document shapes, shared between client pages and API routes.

export interface EventDoc {
  id: string;
  name: string;
  hostUid: string; // Firebase Auth uid of the host who created it
  photoCapPerGuest: number; // max photos any one guest can take
  maxTotalPhotos: number; // hard ceiling across ALL guests combined — bounds storage use regardless of how many guest identities exist
  totalPhotos: number; // running count, updated atomically alongside each upload — what's actually checked against maxTotalPhotos
  startsAt: number; // epoch ms — the guest link/camera doesn't work before this
  endsAt: number; // epoch ms — the guest link/camera doesn't work after this
  revealMode: "immediate" | "delayed"; // "immediate" = visible right after upload
  revealAt: number | null; // epoch ms — when gallery unlocks + Telegram post fires (null if immediate)
  revealed: boolean; // flips true once the reveal has fired
  galleryMode: "shared" | "private"; // shared = all guests can see all photos; private = host-only
  telegramChatId: string | null; // chat/channel id the reveal posts to, set per event
  createdAt: number;
}

export interface GuestDoc {
  id: string; // random id generated client-side, stored in guest's browser (localStorage)
  eventId: string;
  photosTaken: number;
  createdAt: number;
}

export interface PhotoDoc {
  id: string;
  eventId: string;
  guestId: string;
  cloudinaryPublicId: string; // Cloudinary's identifier, used to build a signed URL on demand
  createdAt: number;
}
