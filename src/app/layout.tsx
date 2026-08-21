import type { Metadata } from "next";
import { Fredoka, Inter } from "next/font/google";
import "./globals.css";
import AnimatedBackground from "@/components/AnimatedBackground";

const displayFont = Fredoka({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const bodyFont = Inter({
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Memento — Disposable Camera Events",
  description: "A shared disposable camera for your event, revealed all at once.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  ),
  openGraph: {
    type: "website",
    title: "Memento — Disposable Camera Events",
    description: "A shared disposable camera for your event, revealed all at once.",
    siteName: "Memento",
    images: [{ url: "/memento-preview.png", width: 1200, height: 630, alt: "Memento disposable camera events" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Memento — Disposable Camera Events",
    description: "A shared disposable camera for your event, revealed all at once.",
    images: ["/memento-preview.png"],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${displayFont.variable} ${bodyFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <AnimatedBackground />
        <div className="relative z-10 flex flex-col min-h-full">{children}</div>
      </body>
    </html>
  );
}
