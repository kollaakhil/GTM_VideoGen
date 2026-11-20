import React from "react";
import { AbsoluteFill, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { clampBackgroundLuminance, ensureContrast } from "./contrast";

const FONT = `@font-face { font-family: "DejaVu Sans"; font-weight: 700; src: url("${staticFile("DejaVuSans-Bold.ttf")}") format("truetype"); }`;
const fontFamily = "'DejaVu Sans', sans-serif";

export interface TextCardProps {
  text: string;
  placement: "center" | "upper" | "lower";
  bg: string;
  ink: string;
  accent: string;
}

/**
 * Kinetic text card: hard-cut black background, text fades in and settles with subtle movement.
 * Desaturated colors, restrained type, feels like part of the scene.
 */
export const TextCard: React.FC<TextCardProps> = ({ text, placement, bg, ink, accent }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  
  // Ensure minimum contrast (4.5:1) for legibility
  const adjustedBg = clampBackgroundLuminance(bg);
  const { color: textColor, needsStroke } = ensureContrast(ink, adjustedBg);
  
  // Fade in from black over first 0.3s
  const fadeIn = interpolate(frame, [0, fps * 0.3], [0, 1], { extrapolateRight: "clamp" });
  
  // Subtle spring for text entrance
  const s = spring({ frame, fps, config: { damping: 20, stiffness: 150 }, durationInFrames: 18 });
  
  // Position based on placement
  const yPos = placement === "upper" ? 0.3 : placement === "lower" ? 0.7 : 0.5;
  
  // Fit text size to width
  const maxWidth = width * 0.82;
  const charCount = text.length;
  const baseFontSize = Math.min(height / 12, maxWidth / (charCount * 0.6));
  
  return (
    <AbsoluteFill style={{ backgroundColor: adjustedBg }}>
      <style>{FONT}</style>
      <div style={{ 
        position: "absolute", 
        left: 0, 
        width, 
        top: yPos * height, 
        transform: `translateY(-50%) translateY(${(1 - s) * 12}px)`,
        opacity: fadeIn * s,
        display: "flex", 
        justifyContent: "center",
        padding: "0 8%"
      }}>
        <div style={{ 
          fontFamily, 
          fontWeight: 700, 
          fontSize: baseFontSize, 
          lineHeight: 1.2, 
          color: textColor, 
          textAlign: "center",
          maxWidth,
          borderLeft: `6px solid ${accent}`,
          paddingLeft: baseFontSize * 0.8,
          // Add glow or stroke for low-contrast scenarios
          ...(needsStroke ? {
            textShadow: `0 0 ${baseFontSize * 0.15}px rgba(0,0,0,0.8), 0 0 ${baseFontSize * 0.3}px rgba(0,0,0,0.5)`,
            WebkitTextStroke: `${Math.max(1, baseFontSize * 0.02)}px rgba(0,0,0,0.6)`,
          } : {}),
        }}>
          {text}
        </div>
      </div>
    </AbsoluteFill>
  );
};
