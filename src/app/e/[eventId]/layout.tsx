import type { Metadata } from "next";
import { adminDb } from "@/lib/firebaseAdmin";
import type { EventDoc } from "@/lib/types";

export const runtime = "nodejs";

function getMetadataBase(): URL {
  return new URL(
    process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ eventId: string }>;
}): Promise<Metadata> {
  const { eventId } = await params;
  const eventSnap = await adminDb.collection("events").doc(eventId).get();
  const event = eventSnap.exists ? (eventSnap.data() as EventDoc) : null;
  const title = event ? `${event.name} — Memento` : "Memento event";
  const description = event
    ? `Capture photos for ${event.name}. The album reveals when the host chooses.`
    : "Capture and reveal event photos with Memento.";

  return {
    metadataBase: getMetadataBase(),
    title,
    description,
    openGraph: {
      type: "website",
      title,
      description,
      siteName: "Memento",
      images: [{ url: "/memento-preview.png", width: 1200, height: 630, alt: "Memento event photo preview" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/memento-preview.png"],
    },
  };
}

export default function EventLayout({ children }: { children: React.ReactNode }) {
  return children;
}