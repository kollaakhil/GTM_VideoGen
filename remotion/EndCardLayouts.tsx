import React from "react";
import { AbsoluteFill, Img, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

const FONT = `@font-face { font-family: "DejaVu Sans"; font-weight: 700; src: url("${staticFile("DejaVuSans-Bold.ttf")}") format("truetype"); }`;
const fontFamily = "'DejaVu Sans', sans-serif";

export interface EndCardData {
  brand: string;
  line?: string | null;
  footer?: string | null;
  cta?: string | null;
  logo?: string | null;
  productPhoto?: string | null;
  bg: string;
  ink: "white" | "black";
  accent?: string;
  layout?: string;
}

interface LayoutProps {
  width: number;
  height: number;
  card: EndCardData;
}

const pop = (frame: number, fps: number, delay: number) => 
  spring({ frame: frame - Math.round(delay * fps), fps, config: { damping: 16, stiffness: 170 }, durationInFrames: 12 });

const fit = (w: number, n: number, len: number) => 
  Math.round(Math.min(n, (w * 0.86) / (Math.max(len, 1) * 0.63)));

/** Layout 1: Classic centered - brand large, product photo beside, stacked text */
export const ClassicLayout: React.FC<LayoutProps> = ({ width: w, height: h, card }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ink = card.ink === "white" ? "#fff" : "#000";
  const accent = card.accent || ink;
  const text = (size: number): React.CSSProperties => ({ 
    fontFamily, fontWeight: 700, fontSize: size, color: ink, textAlign: "center", lineHeight: 1.1 
  });
  
  const brandWithPhoto = card.productPhoto ? (
    <div style={{ display: "flex", alignItems: "center", gap: w * 0.04, justifyContent: "center" }}>
      <Img src={card.productPhoto} style={{ width: w * 0.18, height: w * 0.18, objectFit: "cover", borderRadius: w * 0.02 }} />
      <div style={text(fit(w, h / 11, card.brand.length))}>{card.brand}</div>
    </div>
  ) : (
    <div style={text(fit(w, h / 11, card.brand.length))}>{card.brand}</div>
  );
  
  return (
    <AbsoluteFill style={{ backgroundColor: card.bg }}>
      <style>{FONT}</style>
      {card.logo && (
        <div style={{ position: "absolute", top: h * 0.08, left: w * 0.08, width: w * 0.15, opacity: pop(frame, fps, 0) }}>
          <Img src={card.logo} style={{ width: "100%", height: "auto", objectFit: "contain" }} />
        </div>
      )}
      <div style={{ position: "absolute", left: 0, width: w, top: h * 0.4, transform: `translateY(calc(-50% + ${(1 - pop(frame, fps, 0.05)) * 18}px))`, opacity: pop(frame, fps, 0.05), display: "flex", justifyContent: "center" }}>
        {brandWithPhoto}
      </div>
      {card.line && (
        <div style={{ position: "absolute", left: 0, width: w, top: h * 0.52, transform: `translateY(calc(-50% + ${(1 - pop(frame, fps, 0.25)) * 18}px))`, opacity: pop(frame, fps, 0.25), display: "flex", justifyContent: "center" }}>
          <div style={{ ...text(fit(w, h / 28, card.line.length) * 0.9), background: accent, color: card.bg, borderRadius: h / 40, padding: `${h * 0.015}px ${h * 0.03}px` }}>
            {card.line}
          </div>
        </div>
      )}
      {card.cta && (
        <div style={{ position: "absolute", left: 0, width: w, top: h * 0.64, transform: `translateY(-50%)`, opacity: pop(frame, fps, 0.45), display: "flex", justifyContent: "center" }}>
          <div style={{ ...text(fit(w, h / 18, card.cta.length)), color: accent }}>{card.cta}</div>
        </div>
      )}
      {card.footer && (
        <div style={{ position: "absolute", left: 0, width: w, bottom: h * 0.06, opacity: pop(frame, fps, 0.6), display: "flex", justifyContent: "center" }}>
          <div style={{ ...text(fit(w, h / 32, card.footer.length)), opacity: 0.7 }}>{card.footer}</div>
        </div>
      )}
    </AbsoluteFill>
  );
};

/** Layout 2: Split screen - product photo full left half, text on right */
export const SplitScreenLayout: React.FC<LayoutProps> = ({ width: w, height: h, card }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ink = card.ink === "white" ? "#fff" : "#000";
  const accent = card.accent || ink;
  const text = (size: number): React.CSSProperties => ({ 
    fontFamily, fontWeight: 700, fontSize: size, color: ink, textAlign: "left", lineHeight: 1.2 
  });
  
  return (
    <AbsoluteFill style={{ backgroundColor: card.bg, display: "flex" }}>
      <style>{FONT}</style>
      {card.productPhoto && (
        <div style={{ width: w * 0.45, height: h, overflow: "hidden", transform: `translateX(${(1 - pop(frame, fps, 0)) * -w * 0.45}px)` }}>
          <Img src={card.productPhoto} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
      )}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: w * 0.06, gap: h * 0.04, opacity: pop(frame, fps, 0.2), position: "relative" }}>
        {card.logo && (
          <div style={{ position: "absolute", top: w * 0.05, left: w * 0.06, width: w * 0.12 }}>
            <Img src={card.logo} style={{ width: "100%", height: "auto", objectFit: "contain" }} />
          </div>
        )}
        <div style={text(fit(w * 0.5, h / 12, card.brand.length))}>{card.brand}</div>
        {card.line && <div style={{ ...text(fit(w * 0.5, h / 20, card.line.length)), opacity: 0.9 }}>{card.line}</div>}
        {card.cta && <div style={{ ...text(fit(w * 0.5, h / 22, card.cta.length)), marginTop: h * 0.02, color: accent }}>{card.cta}</div>}
        {card.footer && <div style={{ ...text(fit(w * 0.5, h / 28, card.footer.length)), marginTop: h * 0.03, opacity: 0.7 }}>{card.footer}</div>}
      </div>
    </AbsoluteFill>
  );
};

/** Layout 3: Minimal corner - product photo bottom right corner, text top left */
export const MinimalCornerLayout: React.FC<LayoutProps> = ({ width: w, height: h, card }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ink = card.ink === "white" ? "#fff" : "#000";
  const accent = card.accent || ink;
  const text = (size: number): React.CSSProperties => ({ 
    fontFamily, fontWeight: 700, fontSize: size, color: ink, textAlign: "left", lineHeight: 1.15 
  });
  
  return (
    <AbsoluteFill style={{ backgroundColor: card.bg }}>
      <style>{FONT}</style>
      {card.logo && (
        <div style={{ position: "absolute", right: w * 0.08, top: h * 0.08, width: w * 0.12, opacity: pop(frame, fps, 0) }}>
          <Img src={card.logo} style={{ width: "100%", height: "auto", objectFit: "contain" }} />
        </div>
      )}
      <div style={{ position: "absolute", left: w * 0.08, top: h * 0.12, opacity: pop(frame, fps, 0), display: "flex", flexDirection: "column", gap: h * 0.02, maxWidth: w * 0.6 }}>
        <div style={text(fit(w * 0.6, h / 11, card.brand.length))}>{card.brand}</div>
        {card.line && <div style={{ ...text(fit(w * 0.6, h / 24, card.line.length)), opacity: 0.85 }}>{card.line}</div>}
        {card.cta && <div style={{ ...text(fit(w * 0.6, h / 26, card.cta.length)), marginTop: h * 0.01, color: accent }}>{card.cta}</div>}
        {card.footer && <div style={{ ...text(fit(w * 0.6, h / 30, card.footer.length)), marginTop: h * 0.015, opacity: 0.7 }}>{card.footer}</div>}
      </div>
      {card.productPhoto && (
        <div style={{ position: "absolute", right: 0, bottom: 0, width: w * 0.35, height: w * 0.35, transform: `translate(${(1 - pop(frame, fps, 0.3)) * w * 0.2}px, ${(1 - pop(frame, fps, 0.3)) * w * 0.2}px)` }}>
          <Img src={card.productPhoto} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: w * 0.03 }} />
        </div>
      )}
    </AbsoluteFill>
  );
};

/** Layout 4: Hero product - product photo dominates, text overlaid on dark gradient */
export const HeroProductLayout: React.FC<LayoutProps> = ({ width: w, height: h, card }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const accent = card.accent || "#fff";
  const text = (size: number): React.CSSProperties => ({ 
    fontFamily, fontWeight: 700, fontSize: size, color: "#fff", textAlign: "center", lineHeight: 1.2, textShadow: "0 2px 8px rgba(0,0,0,0.6)" 
  });
  
  return (
    <AbsoluteFill style={{ backgroundColor: card.bg }}>
      <style>{FONT}</style>
      {card.productPhoto ? (
        <>
          <div style={{ position: "absolute", inset: 0, opacity: pop(frame, fps, 0) }}>
            <Img src={card.productPhoto} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to bottom, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.7) 100%)" }} />
        </>
      ) : null}
      {card.logo && (
        <div style={{ position: "absolute", top: h * 0.08, left: w * 0.08, width: w * 0.15, opacity: pop(frame, fps, 0.1) }}>
          <Img src={card.logo} style={{ width: "100%", height: "auto", objectFit: "contain", filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.6))" }} />
        </div>
      )}
      <div style={{ position: "absolute", left: 0, width: w, bottom: h * 0.2, opacity: pop(frame, fps, 0.2), display: "flex", flexDirection: "column", gap: h * 0.02, alignItems: "center" }}>
        <div style={text(fit(w, h / 10, card.brand.length))}>{card.brand}</div>
        {card.line && <div style={{ ...text(fit(w, h / 22, card.line.length)), opacity: 0.95 }}>{card.line}</div>}
        {card.cta && <div style={{ ...text(fit(w, h / 24, card.cta.length)), marginTop: h * 0.01, color: accent }}>{card.cta}</div>}
        {card.footer && <div style={{ ...text(fit(w, h / 28, card.footer.length)), marginTop: h * 0.015, opacity: 0.85 }}>{card.footer}</div>}
      </div>
    </AbsoluteFill>
  );
};

export type EndCardLayout = "classic" | "split" | "minimal" | "hero";

export const EndCardLayouts = {
  classic: ClassicLayout,
  split: SplitScreenLayout,
  minimal: MinimalCornerLayout,
  hero: HeroProductLayout,
};

/** Select layout based on concept characteristics */
export function selectEndCardLayout(concept?: { visualWorld?: string; tone?: string; setting?: string } | null, hasProductPhoto?: boolean): EndCardLayout {
  if (!concept) return "classic";
  
  const world = concept.visualWorld?.toLowerCase() || "";
  const tone = concept.tone?.toLowerCase() || "";
  const setting = concept.setting?.toLowerCase() || "";
  
  // Hero layout: when product is the star
  if (hasProductPhoto && (world.includes("hero") || world.includes("dramatic") || tone.includes("bold") || tone.includes("powerful"))) {
    return "hero";
  }
  
  // Split layout: clean, modern, professional
  if (hasProductPhoto && (world.includes("clean") || world.includes("minimal") || world.includes("professional") || setting.includes("studio"))) {
    return "split";
  }
  
  // Minimal layout: understated, elegant
  if (world.includes("minimal") || world.includes("elegant") || world.includes("subtle") || tone.includes("calm") || tone.includes("understated")) {
    return "minimal";
  }
  
  // Classic layout: default
  return "classic";
}
