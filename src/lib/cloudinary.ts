import { v2 as cloudinary } from "cloudinary";

// Server-only. Free-tier Cloudinary account, no card required.
// Get these from the Cloudinary dashboard home page after signup.
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Uploads a photo as an "authenticated" asset — meaning it is NOT publicly
 * viewable by URL. Viewing it later requires a signed delivery URL (see
 * getSignedPhotoUrl below). This is what keeps photos hidden until reveal,
 * on Cloudinary's free plan, without needing their paid access-control tiers.
 */
export async function uploadAuthenticatedPhoto(
  imageBase64: string,
  eventId: string,
  photoId: string
) {
  const result = await cloudinary.uploader.upload(imageBase64, {
    public_id: photoId,
    folder: `memento/${eventId}`,
    type: "authenticated",
    resource_type: "image",
  });
  return result.public_id as string; // store this, not the URL — URLs are signed fresh each time
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
