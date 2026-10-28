import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Newsreader } from "next/font/google";
import "./globals.css";

// Interface type: a clear, quiet grotesk.
const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
});

// Reading type for what you say (and, later, what Relay answers).
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Relay",
  description: "A voice-first engineering briefing for GitHub.",
};

export const viewport: Viewport = {
  themeColor: "#10161d",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${hanken.variable} ${newsreader.variable} h-full antialiased`}>
      <body className="min-h-full bg-ink font-sans text-text">{children}</body>
    </html>
  );
}
