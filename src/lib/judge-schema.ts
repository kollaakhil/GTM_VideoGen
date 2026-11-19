import { z } from "zod";

/**
 * Lenient judge-output fields. Judges routinely write a 350-character note or a seventh fix; a strict `.max()` then
 * rejects the whole verdict, and the gate silently falls back to rules only (the brief judge never counted in E2E
 * run 1: "Brief judge returned an incomplete verdict"). Long strings and lists are clipped instead.
 */
export const text = (max: number) => z.string().transform((s) => s.slice(0, max));
export const list = <T extends z.ZodTypeAny>(item: T, max: number) => z.array(item).transform((a) => a.slice(0, max));
export const texts = (max: number, len: number) => list(text(len), max);
