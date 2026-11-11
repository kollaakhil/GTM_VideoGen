"use client";

import { useState } from "react";
import { Loader2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginForm({ configured }: { configured: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const json = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(json.error ?? "Sign-in failed");
    const next = new URLSearchParams(window.location.search).get("next");
    window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/studio";
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-6">
      <div className="flex items-center gap-2">
        <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white">
          <Zap className="size-4" />
        </div>
        <div className="text-sm font-semibold">Sign in to GTM Engine</div>
      </div>
      {!configured && <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-300">Set ADMIN_EMAIL, ADMIN_PASSWORD and SESSION_SECRET (32+ chars) to enable sign-in.</p>}
      <Input type="email" autoComplete="username" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <Input type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy || !configured}>
        {busy && <Loader2 className="animate-spin" />} Sign in
      </Button>
    </form>
  );
}
