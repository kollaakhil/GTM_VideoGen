"use client";

import { useState } from "react";
import { Plus, Save, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Brand } from "@/lib/types";

type Draft = {
  id?: string;
  url: string;
  name: string;
  offer: string;
  voice: string;
  audience: string;
  logo: string | null;
  fontFamily: string;
  fontFile: string | null;
  colors: { primary: string; accent: string; background: string; text: string };
  toneExamples: string;
  dos: string;
  donts: string;
  winners: { image: string | null; note: string }[];
  photos: string[];
};

const blank: Draft = { url: "https://", name: "", offer: "", voice: "", audience: "", logo: null, fontFamily: "", fontFile: null, colors: { primary: "#111111", accent: "#6366f1", background: "#ffffff", text: "#111111" }, toneExamples: "", dos: "", donts: "", winners: [], photos: [] };

const toDraft = (b: Brand): Draft => ({
  id: b.id,
  url: b.url,
  name: b.name,
  offer: b.offer ?? "",
  voice: b.voice ?? "",
  audience: b.audience ?? "",
  logo: b.logo ?? null,
  fontFamily: b.font?.family ?? "",
  fontFile: b.font?.file ?? null,
  colors: { ...blank.colors, ...Object.fromEntries(Object.entries(b.colorRoles ?? {}).filter(([, v]) => v)) },
  toneExamples: (b.toneExamples ?? []).join("\n"),
  dos: (b.dos ?? []).join("\n"),
  donts: (b.donts ?? []).join("\n"),
  winners: (b.winners ?? []).map((w) => ({ image: w.image ?? null, note: w.note })),
  photos: b.photos ?? [],
});

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 12);
const readFile = (f: File) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result));
  r.onerror = () => rej(r.error);
  r.readAsDataURL(f);
});

const field = "w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-[13px] text-zinc-200 outline-none focus:border-indigo-400/50";
const label = "mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500";

export function BrandsClient({ initial }: { initial: Brand[] }) {
  const [brands, setBrands] = useState(initial);
  const [d, setD] = useState<Draft>(initial[0] ? toDraft(initial[0]) : blank);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: d.url.trim(),
          name: d.name.trim() || undefined,
          offer: d.offer.trim(),
          voice: d.voice.trim(),
          audience: d.audience.trim(),
          logo: d.logo,
          font: d.fontFamily.trim() && d.fontFile ? { family: d.fontFamily.trim(), file: d.fontFile } : null,
          colorRoles: d.colors,
          toneExamples: lines(d.toneExamples),
          dos: lines(d.dos),
          donts: lines(d.donts),
          winners: d.winners.filter((w) => w.note.trim()).map((w) => ({ image: w.image, note: w.note.trim() })),
          photos: d.photos,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Save failed");
      setBrands((bs) => [j.brand, ...bs.filter((b) => b.id !== j.brand.id)]);
      setD(toDraft(j.brand));
      setMsg({ ok: true, text: "Saved. New runs for this brand follow the kit." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const upload = (accept: string, onFile: (data: string) => void, max = 4_000_000) => (
    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-white/5">
      <Upload className="size-3.5" /> Upload
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          if (f.size > max) return setMsg({ ok: false, text: `File is too large (max ${Math.round(max / 1_000_000)} MB).` });
          onFile(await readFile(f));
          e.target.value = "";
        }}
      />
    </label>
  );

  return (
    <div className="grid grid-cols-[240px_1fr] gap-6 p-6">
      <div className="space-y-1.5">
        <Button size="sm" variant="outline" className="mb-2 w-full" onClick={() => setD(blank)}>
          <Plus /> New brand kit
        </Button>
        {brands.map((b) => (
          <button key={b.id} onClick={() => setD(toDraft(b))} className={cn("flex w-full items-center gap-2 rounded-lg p-2 text-left text-sm hover:bg-white/5", d.id === b.id && "bg-white/[0.07]")}>
            <span className="size-6 shrink-0 overflow-hidden rounded bg-white/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {b.logo && <img src={b.logo} alt="" className="h-full w-full object-contain" />}
            </span>
            <span className="truncate">{b.name}</span>
          </button>
        ))}
      </div>
      <div className="max-w-3xl space-y-6">
        <section className="grid grid-cols-2 gap-4">
          <div><span className={label}>Website</span><input className={field} value={d.url} onChange={(e) => set({ url: e.target.value })} /></div>
          <div><span className={label}>Brand name</span><input className={field} value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="Exactly as written" /></div>
          <div className="col-span-2"><span className={label}>Offer & facts (used word for word)</span><textarea rows={2} className={field} value={d.offer} onChange={(e) => set({ offer: e.target.value })} /></div>
          <div><span className={label}>Voice</span><textarea rows={2} className={field} value={d.voice} onChange={(e) => set({ voice: e.target.value })} placeholder="e.g. warm, playful, never salesy" /></div>
          <div><span className={label}>Audience</span><textarea rows={2} className={field} value={d.audience} onChange={(e) => set({ audience: e.target.value })} /></div>
        </section>

        <section className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <span className={label}>Logo (PNG with transparency is best)</span>
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-28 items-center justify-center rounded-lg border border-white/10 bg-[repeating-conic-gradient(#27272a_0%_25%,#18181b_0%_50%)] bg-[length:12px_12px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {d.logo && <img src={d.logo} alt="Logo" className="max-h-12 max-w-24 object-contain" />}
              </div>
              {upload("image/png,image/webp,image/jpeg", (logo) => set({ logo }))}
              {d.logo && <button onClick={() => set({ logo: null })} className="text-zinc-500 hover:text-red-300" aria-label="Remove logo"><Trash2 className="size-4" /></button>}
            </div>
          </div>
          <div className="space-y-2">
            <span className={label}>Brand font (TTF/OTF, used for captions and end cards)</span>
            <div className="flex items-center gap-2">
              <input className={field} value={d.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })} placeholder="Font family name, e.g. Inter" />
              {upload(".ttf,.otf,font/ttf,font/otf", (fontFile) => set({ fontFile }), 2_500_000)}
            </div>
            <div className="text-[11px] text-zinc-500">{d.fontFile ? "Font file attached" : "No font file: captions use the default bold sans"}</div>
          </div>
        </section>

        <section>
          <span className={label}>Color roles</span>
          <div className="flex gap-4">
            {(["primary", "accent", "background", "text"] as const).map((k) => (
              <label key={k} className="flex items-center gap-2 text-xs capitalize text-zinc-300">
                <input type="color" value={d.colors[k]} onChange={(e) => set({ colors: { ...d.colors, [k]: e.target.value } })} className="h-8 w-10 cursor-pointer rounded border border-white/10 bg-transparent" />
                {k}
              </label>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-3 gap-4">
          <div><span className={label}>Tone examples (one per line)</span><textarea rows={5} className={field} value={d.toneExamples} onChange={(e) => set({ toneExamples: e.target.value })} placeholder="Real lines from your ads or site" /></div>
          <div><span className={label}>Always (one per line)</span><textarea rows={5} className={field} value={d.dos} onChange={(e) => set({ dos: e.target.value })} placeholder="Show the product in use" /></div>
          <div><span className={label}>Never (one per line)</span><textarea rows={5} className={field} value={d.donts} onChange={(e) => set({ donts: e.target.value })} placeholder="No discounts above 30%" /></div>
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <span className={label}>Past winning ads (image + why it worked)</span>
            {d.winners.length < 6 && <Button size="sm" variant="ghost" onClick={() => set({ winners: [...d.winners, { image: null, note: "" }] })}><Plus /> Add</Button>}
          </div>
          {d.winners.map((w, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-14 w-11 shrink-0 overflow-hidden rounded bg-white/5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {w.image && <img src={w.image} alt="" className="h-full w-full object-cover" />}
              </div>
              {upload("image/png,image/webp,image/jpeg", (image) => set({ winners: d.winners.map((x, k) => (k === i ? { ...x, image } : x)) }))}
              <input className={field} value={w.note} onChange={(e) => set({ winners: d.winners.map((x, k) => (k === i ? { ...x, note: e.target.value } : x)) })} placeholder="e.g. UGC unboxing, price in first second, 3.1 ROAS" />
              <button onClick={() => set({ winners: d.winners.filter((_, k) => k !== i) })} className="text-zinc-500 hover:text-red-300" aria-label="Remove"><Trash2 className="size-4" /></button>
            </div>
          ))}
        </section>

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving || d.url.length < 10} className="bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white hover:opacity-90"><Save /> {saving ? "Saving…" : "Save brand kit"}</Button>
          {msg && <span className={cn("text-xs", msg.ok ? "text-emerald-300" : "text-red-300")}>{msg.text}</span>}
        </div>
      </div>
    </div>
  );
}
