import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { devAuthUser } from "@/lib/session";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Ad Scaler", template: "%s · Ad Scaler" },
  description: "Your co-pilot for scaling ads: creative strategy and budget decisions, always your call.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const body = (
    <html lang="en">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
  return devAuthUser ? body : <ClerkProvider>{body}</ClerkProvider>;
}
