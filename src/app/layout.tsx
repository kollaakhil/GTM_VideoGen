import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Sidebar } from "@/components/sidebar";
import { list } from "@/lib/store";
import { aiConfigured } from "@/lib/ai";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "GTM Engine",
  description: "AI marketing studio: research, creative, QA, publishing and signals",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  const inbox = session ? await list("inbox_items") : [];
  const pending = inbox.filter((i) => i.status === "pending").length;
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <div className="flex min-h-screen">
          <Sidebar pending={pending} demo={!aiConfigured()} user={session?.email ?? null} />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}
