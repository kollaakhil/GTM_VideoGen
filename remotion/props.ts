/** Props shared by the Remotion compositions and src/lib/motion-graphics.ts (plain data only). */
export type Box = { x: number; y: number; w: number; h: number };
export type CaptionLine = { start: number; end: number; text: string; y: number };
export type OverlayLine = { start: number; end: number; text: string; y: number; kind: "tag" | "callout" };
export type EndCardProps = { brand: string; line?: string; cta?: string; footer?: string; bg: string; ink: "black" | "white"; logo?: string | null; accent: string; productPhoto?: string | null };
export type OverlayProps = { width: number; height: number; seconds: number; size: number; captions: CaptionLine[]; overlays: OverlayLine[]; accent: string; compact: boolean };
export type CardProps = { width: number; height: number; seconds: number; card: EndCardProps };
export type TextCardProps = { text: string; placement: "center" | "upper" | "lower"; bg: string; ink: string; accent: string };
export type LowerThirdProps = { text: string; placement: string; bg: string; accent: string; backgroundClip?: string };
