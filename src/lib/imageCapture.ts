"use client";

// Cloudinary's free tier caps uploads at 10MB — we stay under that with
// margin so a slightly-off estimate never causes a hard rejection.
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Captures a single still photo from a live camera track at the highest
 * quality the browser can give us.
 *
 * ImageCapture.takePhoto() (Chrome/Android/Edge/Samsung Internet) reads
 * directly from the camera hardware at its full still-photo resolution —
 * meaningfully sharper than grabbing a frame from the video preview stream,
 * since preview streams are typically capped lower for smooth playback.
 *
 * Safari doesn't support ImageCapture at all (macOS, iPadOS, or iOS, in any
 * version as of this writing) — it falls back to a canvas snapshot of the
 * video element instead, which is why requesting a high-resolution stream
 * in getUserMedia (done where this is called from) still matters even with
 * ImageCapture in the picture.
 */
export async function captureHighQualityPhoto(
  video: HTMLVideoElement,
  track: MediaStreamTrack
): Promise<Blob> {
  const ImageCaptureCtor = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { takePhoto(): Promise<Blob> } }).ImageCapture;

  if (ImageCaptureCtor) {
    try {
      const capture = new ImageCaptureCtor(track);
      const blob = await capture.takePhoto();
      return ensureUnderBudget(blob);
    } catch {
      // Some devices reject takePhoto() intermittently (e.g. called too
      // soon after the stream starts) — fall through to the canvas method.
    }
  }
  return captureFromCanvas(video);
}

function captureFromCanvas(video: HTMLVideoElement): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(video, 0, 0);
  return encodeCanvasUnderBudget(canvas, 0.92);
}

/** Re-encodes only if the hardware-captured blob is already over budget. */
async function ensureUnderBudget(blob: Blob): Promise<Blob> {
  if (blob.size <= MAX_UPLOAD_BYTES) return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return blob;
  ctx.drawImage(bitmap, 0, 0);
  return encodeCanvasUnderBudget(canvas, 0.9);
}

/**
 * Steps quality (and, if that's not enough, resolution) down until the
 * result fits under MAX_UPLOAD_BYTES. Most shots never touch this — it only
 * activates for very high-megapixel captures.
 */
async function encodeCanvasUnderBudget(
  canvas: HTMLCanvasElement,
  startQuality: number
): Promise<Blob> {
  let quality = startQuality;
  let scale = 1;
  for (let attempt = 0; attempt < 8; attempt++) {
    const blob = await toBlob(canvas, quality, scale);
    if (blob.size <= MAX_UPLOAD_BYTES || (quality <= 0.5 && scale <= 0.6)) {
      return blob;
    }
    if (quality > 0.6) {
      quality -= 0.1;
    } else {
      scale -= 0.15;
    }
  }
  return toBlob(canvas, 0.5, 0.6);
}

function toBlob(canvas: HTMLCanvasElement, quality: number, scale: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    let target = canvas;
    if (scale < 1) {
      const scaled = document.createElement("canvas");
      scaled.width = Math.round(canvas.width * scale);
      scaled.height = Math.round(canvas.height * scale);
      const ctx = scaled.getContext("2d");
      if (ctx) {
        ctx.drawImage(canvas, 0, 0, scaled.width, scaled.height);
        target = scaled;
      }
    }
    target.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      quality
    );
  });
}
