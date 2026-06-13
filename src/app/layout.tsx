import type { Metadata } from "next";
import { Figtree, IBM_Plex_Mono, Libre_Baskerville } from "next/font/google";
import { AuthProvider } from "@/lib/AuthContext";
import "./globals.css";

const libreBaskerville = Libre_Baskerville({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-libre-baskerville",
});

const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-ibm-plex-mono",
});

export const metadata: Metadata = {
  title: "Intake — Your health story, organized before the appointment",
  description:
    "Patient-owned health intelligence workspace. Ingest EMR, voice, and doctor notes into a knowledge graph with risk alerts and specialty reports.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${libreBaskerville.variable} ${figtree.variable} ${ibmPlexMono.variable} font-sans antialiased`}
      >
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
