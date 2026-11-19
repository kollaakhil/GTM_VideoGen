import React from "react";
import { AbsoluteFill, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

const FONT = `@font-face { font-family: "DejaVu Sans"; font-weight: 700; src: url("${staticFile("DejaVuSans-Bold.ttf")}") format("truetype"); }`;
const fontFamily = "'DejaVu Sans', sans-serif";

export interface LowerThirdProps {
  text: string;
  placement: string;
  bg: string;
  accent: string;
  backgroundClip?: string;
}

/**
 * Lower third text overlay: slides in over optional background clip, semi-transparent backing.
 * Used for labels, captions, and scene text.
 */
export const LowerThird: React.FC<LowerThirdProps> = ({ text, placement, bg, accent, backgroundClip }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  
  // Slide in from left over 0.4s
  const slideIn = spring({ frame, fps, config: { damping: 18, stiffness: 180 }, durationInFrames: 12 });
  
  // Position based on placement string
  const isLower = /lower|bottom/i.test(placement);
  const isUpper = /upper|top/i.test(placement);
  const yPos = isLower ? 0.82 : isUpper ? 0.18 : 0.5;
  
  // Fit text
  const fontSize = Math.min(height / 22, width * 0.045);
  const xOffset = (1 - slideIn) * -40;
  
  return (
    <AbsoluteFill style={{ backgroundColor: backgroundClip ? "transparent" : bg }}>
      <style>{FONT}</style>
      {backgroundClip && (
        <video 
          src={backgroundClip} 
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          muted 
          loop 
          playsInline
        />
      )}
      <div style={{ 
        position: "absolute", 
        left: 0, 
        width, 
        top: yPos * height, 
        transform: `translateY(-50%) translateX(${xOffset}px)`,
        opacity: slideIn,
        display: "flex", 
        justifyContent: "flex-start",
        padding: "0 4%"
      }}>
        <div style={{ 
          fontFamily, 
          fontWeight: 700, 
          fontSize, 
          lineHeight: 1.15, 
          color: "#ffffff", 
          textAlign: "left",
          background: "rgba(0, 0, 0, 0.75)",
          borderRadius: fontSize * 0.3,
          padding: `${fontSize * 0.3}px ${fontSize * 0.6}px`,
          borderLeft: `${Math.max(4, fontSize * 0.2)}px solid ${accent}`,
          maxWidth: width * 0.88,
        }}>
          {text}
        </div>
      </div>
    </AbsoluteFill>
  );
};
