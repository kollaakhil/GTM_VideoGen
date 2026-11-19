import React from "react";
import { AbsoluteFill, Composition, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionLine, CardProps, OverlayLine, OverlayProps } from "./props";

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

/** End card: logo, wordmark, offer tag, CTA and footer stagger in and settle by 0.9 s, at the OCR layout's fixed heights. */
export const CardComp: React.FC<CardProps> = ({ width: w, height: h, card }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ink = card.ink === "white" ? "#fff" : "#000";
  const pop = (delay: number) => spring({ frame: frame - Math.round(delay * fps), fps, config: { damping: 16, stiffness: 170 }, durationInFrames: 12 });
  // One line each (OCR reads fixed bands): DejaVu Sans Bold averages ~0.63 em per character.
  const fit = (n: number, len: number) => Math.round(Math.min(n, (w * 0.86) / (Math.max(len, 1) * 0.63)));
  const row = (y: number, delay: number, child: React.ReactNode) => {
    const s = pop(delay);
    return <div style={{ position: "absolute", left: 0, width: w, top: y * h, transform: `translateY(calc(-50% + ${(1 - s) * 18}px))`, opacity: s, display: "flex", justifyContent: "center" }}>{child}</div>;
  };
  const text = (size: number): React.CSSProperties => ({ fontFamily, fontWeight: 700, fontSize: size, color: ink, textAlign: "center", lineHeight: 1.1, whiteSpace: "nowrap" });
  const inverse = card.ink === "white" ? "#000" : "#fff";
  const lineSize = fit(h / 28, card.line?.length ?? 1);
  return (
    <AbsoluteFill style={{ backgroundColor: card.bg }}>
      <style>{FONT}</style>
      {card.logo ? row(0.24, 0, <Img src={card.logo} style={{ width: w * 0.42 }} />) : null}
      {row(0.4, 0.05, <div style={text(fit(h / 11, card.brand.length))}>{card.brand}</div>)}
      {card.line ? row(0.52, 0.25, <div style={{ ...text(Math.round(lineSize * 0.9)), color: card.bg === inverse ? ink : card.bg, background: ink, borderRadius: lineSize * 0.4, padding: `${lineSize * 0.16}px ${lineSize * 0.45}px` }}>{card.line}</div>) : null}
      {card.cta ? row(0.64, 0.45, <div style={text(fit(h / 18, card.cta.length))}>{card.cta}</div>) : null}
      {card.footer ? row(0.76, 0.65, <div style={{ ...text(fit(h / 34, card.footer.length)), opacity: 0.92 }}>{card.footer}</div>) : null}
    </AbsoluteFill>
  );
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
  </>
);
