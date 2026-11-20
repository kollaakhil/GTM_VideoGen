import React from "react";
import { AbsoluteFill, Composition, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionLine, CardProps, OverlayLine, OverlayProps, TextCardProps, LowerThirdProps } from "./props";
import { TextCard } from "./TextCard";
import { LowerThird } from "./LowerThird";
import { EndCardLayouts } from "./EndCardLayouts";

const FONT = `@font-face { font-family: "DejaVu Sans"; font-weight: 700; src: url("${staticFile("DejaVuSans-Bold.ttf")}") format("truetype"); }`;
const fontFamily = "'DejaVu Sans', sans-serif";

const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};

/** Animated caption: springs in, the word being spoken turns accent yellow (still bright enough for OCR binarisation). */
const Caption: React.FC<{ c: CaptionLine; size: number; compact: boolean }> = ({ c, size, compact }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  if (t < c.start || t >= c.end) return null;
  const local = frame - Math.round(c.start * fps);
  const s = spring({ frame: local, fps, config: { damping: 18, stiffness: 220 }, durationInFrames: 6 });
  const words = c.text.split(/\s+/);
  const active = Math.min(words.length - 1, Math.floor(((t - c.start) / Math.max(0.01, c.end - c.start)) * words.length));
  return (
    <div style={{ position: "absolute", left: 0, width, top: c.y * height, transform: `translateY(-50%) scale(${0.92 + 0.08 * s})`, opacity: s, display: "flex", justifyContent: "center" }}>
      <div style={{ maxWidth: width * 0.84 + size * 0.8, boxSizing: "border-box", background: `rgba(0,0,0,${compact ? 0.81 : 0.72})`, borderRadius: size * 0.3, padding: `${size * 0.22}px ${size * 0.4}px`, fontFamily, fontWeight: 700, fontSize: size, lineHeight: 1.18, color: "#fff", textAlign: "center" }}>
        {words.map((w, i) => <span key={i} style={{ color: i === active ? "#FFE14D" : "#fff" }}>{w}{i < words.length - 1 ? " " : ""}</span>)}
      </div>
    </div>
  );
};

/** On-screen message: offers and prices become a tilted tag that pops in; other lines slide in as a callout with an accent bar. */
const Overlay: React.FC<{ o: OverlayLine; size: number; accent: string }> = ({ o, size, accent }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  if (t < o.start || t >= o.end) return null;
  const local = frame - Math.round(o.start * fps);
  const s = spring({ frame: local, fps, config: { damping: 12, stiffness: 180 }, durationInFrames: 10 });
  // Out-fade of 0.08 s (was 0.2): overlays end on a cut, and a 0.2 s fade put a half-transparent backing on the export
  // review's last sampled frame (0.96 of the shot): "overlay banner backing drops out" / "loses opacity" (13.32).
  const out = interpolate(t, [o.end - 0.08, o.end], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fs = size * 0.8;
  const tagBg = lum(accent) < 0.5 ? accent : "#141414";
  const common: React.CSSProperties = { fontFamily, fontWeight: 700, fontSize: fs, lineHeight: 1.15, color: "#fff", textAlign: "center", maxWidth: width * 0.8 };
  return (
    <div style={{ position: "absolute", left: 0, width, top: o.y * height, transform: "translateY(-50%)", display: "flex", justifyContent: "center", opacity: out }}>
      {o.kind === "tag" ? (
        <div style={{ ...common, background: tagBg, borderRadius: fs * 0.35, padding: `${fs * 0.28}px ${fs * 0.55}px`, transform: `rotate(${-3 * s}deg) scale(${0.6 + 0.4 * s})`, boxShadow: "0 6px 18px rgba(0,0,0,0.35)", border: "3px solid #fff" }}>{o.text}</div>
      ) : (
        <div style={{ ...common, background: "rgba(0,0,0,0.8)", borderRadius: fs * 0.25, padding: `${fs * 0.24}px ${fs * 0.5}px`, borderLeft: `${Math.max(6, fs * 0.22)}px solid ${accent}`, transform: `translateX(${(1 - s) * -24}px)`, opacity: s }}>{o.text}</div>
      )}
    </div>
  );
};

export const OverlayComp: React.FC<OverlayProps> = (p) => (
  <AbsoluteFill style={{ backgroundColor: "transparent" }}>
    <style>{FONT}</style>
    {p.captions.map((c, i) => <Caption key={`c${i}`} c={c} size={p.size} compact={p.compact} />)}
    {p.overlays.map((o, i) => <Overlay key={`o${i}`} o={o} size={p.size} accent={p.accent} />)}
  </AbsoluteFill>
);

/** End card: uses layout-specific rendering based on concept */
export const CardComp: React.FC<CardProps> = ({ width: w, height: h, card }) => {
  const layout = card.layout || "classic";
  const LayoutComponent = EndCardLayouts[layout];
  
  return <LayoutComponent width={w} height={h} card={card} />;
};

const fps = 30;
export const Root: React.FC = () => (
  <>
    <Composition id="Overlay" component={OverlayComp} fps={fps} width={486} height={864} durationInFrames={30}
      defaultProps={{ width: 486, height: 864, seconds: 1, size: 30, captions: [], overlays: [], accent: "#FFE14D", compact: false } as OverlayProps}
      calculateMetadata={({ props }) => ({ width: props.width, height: props.height, durationInFrames: Math.max(1, Math.round(props.seconds * fps)) })} />
    <Composition id="EndCard" component={CardComp} fps={fps} width={486} height={864} durationInFrames={75}
      defaultProps={{ width: 486, height: 864, seconds: 2.5, card: { brand: "Brand", bg: "#111111", ink: "white", accent: "#FFE14D" } } as CardProps}
      calculateMetadata={({ props }) => ({ width: props.width, height: props.height, durationInFrames: Math.max(1, Math.round(props.seconds * fps)) })} />
    <Composition id="TextCard" component={TextCard as unknown as React.FC<Record<string, unknown>>} fps={fps} width={486} height={864} durationInFrames={60}
      defaultProps={{ text: "Sample Text", placement: "center", bg: "#0b0b0f", ink: "#ffffff", accent: "#666666" } as Record<string, unknown>} />
    <Composition id="LowerThird" component={LowerThird as unknown as React.FC<Record<string, unknown>>} fps={fps} width={486} height={864} durationInFrames={60}
      defaultProps={{ text: "Sample Text", placement: "lower third", bg: "#0b0b0f", accent: "#666666" } as Record<string, unknown>} />
  </>
);
