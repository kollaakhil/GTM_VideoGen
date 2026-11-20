/**
 * Color contrast utilities for accessible text rendering.
 * WCAG AA requires 4.5:1 contrast ratio for normal text.
 */

/** Convert hex color to RGB [0-255] */
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r, g, b];
}

/** Calculate relative luminance (0-1) from RGB [0-255] */
function luminance([r, g, b]: [number, number, number]): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/** Calculate WCAG contrast ratio between two hex colors (1-21) */
export function contrastRatio(fg: string, bg: string): number {
  const l1 = luminance(hexToRgb(fg));
  const l2 = luminance(hexToRgb(bg));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Check if text color has sufficient contrast (4.5:1 minimum for WCAG AA) */
export function hasSufficientContrast(fg: string, bg: string): boolean {
  return contrastRatio(fg, bg) >= 4.5;
}

/** 
 * Choose high-contrast text color. If the provided ink doesn't meet 4.5:1 contrast,
 * returns white for dark backgrounds or near-black for light backgrounds.
 */
export function ensureContrast(ink: string, bg: string): { color: string; needsStroke: boolean } {
  if (hasSufficientContrast(ink, bg)) {
    return { color: ink, needsStroke: false };
  }
  
  // Choose white for dark backgrounds, near-black for light
  const bgLum = luminance(hexToRgb(bg));
  const safeColor = bgLum < 0.5 ? "#ffffff" : "#0f0f0f";
  
  return { color: safeColor, needsStroke: true };
}

/** 
 * Clamp background to ensure it's not too dark (near-black) for dark text.
 * Returns adjusted background color that maintains minimum luminance.
 * Default minLuminance of 0.05 allows fairly dark backgrounds while preventing pure black.
 */
export function clampBackgroundLuminance(bg: string, minLuminance = 0.05): string {
  const [r, g, b] = hexToRgb(bg);
  const lum = luminance([r, g, b]);
  
  if (lum >= minLuminance) return bg;
  
  // For pure black or very dark colors, set to minimum gray level
  if (lum < 0.001) {
    const gray = Math.round(Math.sqrt(minLuminance) * 255);
    return `#${gray.toString(16).padStart(2, "0")}${gray.toString(16).padStart(2, "0")}${gray.toString(16).padStart(2, "0")}`;
  }
  
  // Scale RGB values to reach minimum luminance
  const scale = Math.sqrt(minLuminance / lum);
  const nr = Math.min(255, Math.round(r * scale));
  const ng = Math.min(255, Math.round(g * scale));
  const nb = Math.min(255, Math.round(b * scale));
  
  return `#${nr.toString(16).padStart(2, "0")}${ng.toString(16).padStart(2, "0")}${nb.toString(16).padStart(2, "0")}`;
}
