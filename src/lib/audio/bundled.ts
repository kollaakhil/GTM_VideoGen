/**
 * Bundled royalty-free audio - last resort when all model calls fail.
 * These are used only when the fallback chain is exhausted.
 */

import fs from "node:fs/promises";
import path from "node:path";

/**
 * Load bundled audio file from public/audio directory.
 * For now, returns a data URL of silence until we add actual bundled files.
 */
export async function loadBundledAudio(filename: string, durationSeconds: number): Promise<string> {
  const audioPath = path.join(process.cwd(), "public", "audio", "bundled", filename);
  
  try {
    const exists = await fs.access(audioPath).then(() => true).catch(() => false);
    if (exists) {
      const buffer = await fs.readFile(audioPath);
      return `data:audio/wav;base64,${buffer.toString("base64")}`;
    }
  } catch (error) {
    console.warn(`[bundled-audio] Could not load ${filename}:`, error);
  }
  
  // Fallback to generated silence
  return generateSilence(durationSeconds);
}

/**
 * Generate a silent audio file as absolute last resort.
 * WAV header for 44.1kHz mono PCM silence.
 */
export function generateSilence(durationSeconds: number): string {
  const sampleRate = 44100;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const dataSize = numSamples * 2; // 16-bit samples
  
  const buffer = Buffer.alloc(44 + dataSize);
  
  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  
  // fmt chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16); // chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  
  // data chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  // Data is already zeros from Buffer.alloc
  
  return `data:audio/wav;base64,${buffer.toString("base64")}`;
}
