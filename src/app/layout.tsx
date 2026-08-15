import type { Metadata } from "next";
import { Space_Grotesk, Inter, IBM_Plex_Mono, Bebas_Neue } from "next/font/google";
import "./globals.css";

const heroFont = Bebas_Neue({
  variable: "--font-hero",
  subsets: ["latin"],
  weight: ["400"],
});

const displayFont = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "700"],
});

const bodyFont = Inter({
  variable: "--font-body",
  subsets: ["latin"],
});

const monoFont = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Memento — Disposable Camera Events",
  description: "A shared disposable camera for your event, revealed all at once.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${heroFont.variable} ${displayFont.variable} ${bodyFont.variable} ${monoFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col dusk-bg">
        <div className="dusk-blob dusk-blob-amber" aria-hidden="true" />
        <div className="dusk-blob dusk-blob-violet" aria-hidden="true" />
        <div className="relative z-10 flex flex-col min-h-full">{children}</div>
      </body>
    </html>
  );
}
