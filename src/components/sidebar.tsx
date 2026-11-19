"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Inbox, LayoutGrid, LogOut, Megaphone, Palette, Plug, Sparkles, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/studio", label: "Studio", icon: Sparkles },
  { href: "/studio/classic", label: "Studio (classic)", icon: Sparkles },
  { href: "/library", label: "Library", icon: LayoutGrid },
  { href: "/brands", label: "Brand kits", icon: Palette },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/performance", label: "Performance", icon: BarChart3 },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/connections", label: "Connections", icon: Plug },
];

export function Sidebar({ pending, demo, user }: { pending: number; demo: boolean; user: string | null }) {
  const path = usePathname();
  if (path.startsWith("/login")) return null;
  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r bg-sidebar px-3 py-4">
      <div className="mb-6 flex items-center gap-2 px-2">
        <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white">
          <Zap className="size-4" />
        </div>
        <div>
          <div className="text-sm font-semibold leading-tight">GTM Engine</div>
          <div className="text-xs text-muted-foreground">Marketing studio</div>
        </div>
      </div>
      <nav className="flex flex-col gap-1">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground",
              path.startsWith(href) && "bg-sidebar-accent font-medium text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
            {href === "/inbox" && pending > 0 && (
              <span className="ml-auto rounded-full bg-indigo-500 px-1.5 text-[10px] font-semibold text-white">{pending}</span>
            )}
          </Link>
        ))}
      </nav>
      <div className="mt-auto" />
      {demo && (
        <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
          <div className="font-medium">Demo mode</div>
          Add keys on the Connections page to go live.
        </div>
      )}
      {user && (
        <div className="flex items-center gap-2 border-t border-white/[0.06] px-2 pt-3 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate" title={user}>{user}</span>
          <button
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              window.location.href = "/login";
            }}
            className="rounded-md p-1 hover:bg-sidebar-accent hover:text-foreground"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="size-3.5" />
          </button>
        </div>
      )}
    </aside>
  );
}
