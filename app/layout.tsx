import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { DeveloperMenu } from "@/app/components/developer-menu";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Rec League",
    template: "%s · Rec League",
  },
  description:
    "Build a complete rec league schedule, report scores, and share one public page for games and standings.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        {process.env.NODE_ENV === "production" ? null : <DeveloperMenu />}
      </body>
    </html>
  );
}
