import { v2 as cloudinary } from "cloudinary";

// Server-only. Free-tier Cloudinary account, no card required.
// Get these from the Cloudinary dashboard home page after signup.
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Builds the signed parameters a browser needs to upload a photo DIRECTLY to
 * Cloudinary, bypassing our own server entirely for the actual image bytes.
 *
 * This exists because Vercel Serverless Functions enforce a hard 4.5MB
 * request body limit at the infrastructure level (not configurable) — full
 * quality photos routinely exceed that, so they can never be sent through
 * one of our own API routes. Cloudinary's own upload limit (10MB on the
 * free plan) is the real ceiling once the bytes go straight there instead.
 *
 * type: "authenticated" keeps the asset un-viewable by a bare URL — same
 * privacy model as before, just uploaded via a different path.
 */
export function createSignedUploadParams(eventId: string, photoId: string) {
  const timestamp = Math.round(Date.now() / 1000);
  const publicId = `memento/${eventId}/${photoId}`;
  const paramsToSign = { timestamp, public_id: publicId, type: "authenticated" };
  const signature = cloudinary.utils.api_sign_request(
    paramsToSign,
    process.env.CLOUDINARY_API_SECRET!
  );
  return {
    publicId,
    timestamp,
    signature,
    apiKey: process.env.CLOUDINARY_API_KEY!,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME!,
  };
}

/**
 * Generates a signed URL for an authenticated asset — required to view it,
 * since it was uploaded with type: "authenticated". This uses Cloudinary's
 * standard delivery-URL signing (available on the free plan). Note: unlike
 * Firebase's signed URLs, this does NOT expire after a set time — that
 * requires Cloudinary's token-based access control, which is an Advanced-plan
 * feature. For this app that's fine: the URL is only ever generated and
 * handed out by the server after the reveal condition is actually met
 * (gallery API checks event.revealed; the Telegram post only fires at
 * reveal time), so there's no path for a guest to get one early.
 */
export function getSignedPhotoUrl(publicId: string) {
  return cloudinary.url(publicId, {
    type: "authenticated",
    resource_type: "image",
    sign_url: true,
    secure: true,
  });
}

/**
 * Permanently removes a photo from Cloudinary. Used when an event is
 * deleted — without this, deleting the Firestore docs alone would leave the
 * actual image files sitting in storage forever, quietly eating into the
 * free-tier quota.
 */
export async function deleteAuthenticatedPhoto(publicId: string) {
  await cloudinary.uploader.destroy(publicId, {
    type: "authenticated",
    resource_type: "image",
  });
}

export default cloudinary;
