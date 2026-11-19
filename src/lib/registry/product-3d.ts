import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { downloadAsDataUrl, falRun } from "../ai";
import { buildFalBody } from "./fal-knobs";
import { FAL_KNOBS } from "./fal-snapshot";
import { AUTO, estimateUsd, getModel } from "./index";
import { modelReady } from "./ready";

/**
 * Product 3D asset step: one brand product photo in, one textured GLB out, so Blender can import the real product mesh for
 * product and hero shots instead of a hand-built model. Results are cached by a hash of the input, so a re-run, a retry or
 * a second shot of the same product costs nothing.
 *
 * Use it only for irregular products (see `classifyProduct`): cans, bottles and boxes are better as a procedural primitive.
 *
 * Request and response fields were read from fal's OpenAPI for speridlabs/idol/max and /max/turbo on 2026-11-19:
 * in `image_url`, `image_type` ("real" for photographs), `enable_pbr`, `mesh_resolution`, `rig`; out `game_glb` (30k triangles,
 * UVs, 2048 px base color and normal map). `model_glb` is a vertex-coloured mesh with no texture, so it is never used here:
 * a label has to stay sharp.
 */
export const PRODUCT_3D_VERSION = 1;
export const PRODUCT_3D_TURBO = "speridlabs/idol/max/turbo";
export const PRODUCT_3D_QUALITY = "speridlabs/idol/max";
/** Auto: Max for finals (sharper label, cleaner surface), Turbo for previews (about 20 s, half the price). Either falls back to the other. */
export const PRODUCT_3D_AUTO_ORDER = { final: [PRODUCT_3D_QUALITY, PRODUCT_3D_TURBO], preview: [PRODUCT_3D_TURBO, PRODUCT_3D_QUALITY] } as const;

export type ProductShape = "primitive" | "irregular" | "unknown";
const PRIMITIVE = /\b(cans?|sodas?|bottles?|jars?|boxes|box|cartons?|tubes?|pouch(?:es)?|cups?|tins?|packs?|packages?|cylinders?|sticks?)\b/i;
const IRREGULAR = /\b(shoes?|sneakers?|boots?|toys?|plush|figures?|figurines?|characters?|gadgets?|devices?|phones?|headphones?|earbuds?|watch(?:es)?|robots?|bags?|backpacks?|chairs?|lamps?|bikes?|cars?|furniture|apparel|jackets?|hats?|helmets?|glasses|sunglasses|controllers?|speakers?)\b/i;

/**
 * Which route a product takes. Primitive products (cans, bottles, boxes, tubes) stay on the free procedural Blender primitive
 * with the label image UV-wrapped: a real test on the OLIPOP can (2026-11-19) came back with condensation baked into lumpy
 * geometry, a wobbly silhouette and an invented back. Irregular products (shoes, toys, gadgets, characters) have no primitive
 * to wrap, so they get an Idol mesh. Anything we cannot classify stays on the primitive: a paid mesh needs a positive reason.
 * Primitive wins when both words appear ("toy in a box" is sold as a box).
 */
export function classifyProduct(kind: string | undefined): ProductShape {
  if (!kind) return "unknown";
  if (PRIMITIVE.test(kind)) return "primitive";
  return IRREGULAR.test(kind) ? "irregular" : "unknown";
}

export interface ProductMeshOptions {
  /** Product photo: an https URL fal can fetch, or a data URL. */
  image: string;
  /** A registry id, or "auto"/undefined: Idol Max for finals, Turbo for previews. */
  model?: string;
  /** Final or preview; decides what Auto picks. Defaults to final. */
  mode?: "preview" | "final";
  /** Add roughness and metallic maps (adds 20 s to 2 min). Off by default: labels are printed, not metallic. */
  pbr?: boolean;
  /** "real" for photographs (looser crop), "synthetic" for renders. Defaults to "real": brand photos are photographs. */
  imageType?: "real" | "synthetic";
  /** 128 to 1536; fal's default is 1024. */
  meshResolution?: number;
  /** Where cached meshes live. Defaults to `$DATA_DIR/cache/product-3d`. */
  cacheDir?: string;
  /** Test hooks: production uses fal and the connected key. */
  run?: (endpoint: string, body: Record<string, unknown>) => Promise<unknown>;
  download?: (url: string) => Promise<Buffer>;
  ready?: (id: string) => boolean;
}

export interface ProductMesh {
  /** Absolute path of the GLB on disk, for Blender's importer. */
  glbPath: string;
  modelId: string;
  cached: boolean;
  /** Spend for this call: 0 on a cache hit. */
  costUsd: number;
  key: string;
  bytes: number;
  triangles?: number;
}

export class ProductMeshError extends Error {
  constructor(message: string, readonly code: "bad_input" | "no_model" | "no_schema" | "no_mesh" | "bad_mesh") {
    super(message);
    this.name = "ProductMeshError";
  }
}

const MESH_RESOLUTIONS = [128, 256, 512, 768, 1024, 1536];

/** Picks the model for the stage: Auto means Idol Max for finals and Turbo for previews (the other if one is not connected). Explicit ids must serve asset3d. */
export function pickProductMeshModel(model: string | undefined, ready: (id: string) => boolean = modelReady, mode: "preview" | "final" = "final"): string {
  if (model && model !== AUTO) {
    const e = getModel(model);
    if (!e || !e.stages.includes("asset3d")) throw new ProductMeshError(`${model} is not an image-to-3D model in the registry`, "no_model");
    if (!e.runnable || !ready(model)) throw new ProductMeshError(`${e.label} is not available right now`, "no_model");
    return model;
  }
  const id = PRODUCT_3D_AUTO_ORDER[mode].find((m) => getModel(m)?.runnable && ready(m));
  if (!id) throw new ProductMeshError("No image-to-3D model is connected. Add a fal key in Connections.", "no_model");
  return id;
}

/** Hash of what makes the mesh different: the image bytes (the URL text for remote images), model and options. */
export function productMeshKey(o: { image: string; modelId: string; pbr: boolean; imageType: string; meshResolution?: number }): string {
  const m = /^data:[^;,]*(?:;base64)?,([\s\S]*)$/.exec(o.image);
  const img = createHash("sha256").update(m ? Buffer.from(m[1], "base64") : o.image).digest("hex");
  return createHash("sha256").update(JSON.stringify({ v: PRODUCT_3D_VERSION, img, model: o.modelId, pbr: o.pbr, type: o.imageType, res: o.meshResolution ?? null })).digest("hex").slice(0, 32);
}

export const defaultCacheDir = () => path.join(process.env.DATA_DIR || path.join(process.cwd(), ".data"), "cache", "product-3d");

const isGlb = (b: Buffer) => b.length > 12 && b.subarray(0, 4).toString("latin1") === "glTF";

async function fetchBuffer(url: string): Promise<Buffer> {
  if (url.startsWith("data:")) return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
  const dataUrl = await downloadAsDataUrl(url);
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}

async function readCached(glb: string, meta: string): Promise<{ bytes: number; triangles?: number } | null> {
  try {
    const [b, m] = await Promise.all([fs.readFile(glb), fs.readFile(meta, "utf8").catch(() => "{}")]);
    return isGlb(b) ? { bytes: b.length, triangles: (JSON.parse(m) as { triangles?: number }).triangles } : null;
  } catch {
    return null;
  }
}

/** Turns a product photo into a cached GLB. Never calls fal when the same input was already meshed. */
export async function generateProductMesh(o: ProductMeshOptions): Promise<ProductMesh> {
  if (!o.image || !/^(https?:\/\/|data:image\/)/.test(o.image)) throw new ProductMeshError("The product 3D asset needs a product photo (an https URL or an image data URL)", "bad_input");
  if (o.meshResolution !== undefined && !MESH_RESOLUTIONS.includes(o.meshResolution)) throw new ProductMeshError(`mesh_resolution must be one of ${MESH_RESOLUTIONS.join(", ")}`, "bad_input");
  const modelId = pickProductMeshModel(o.model, o.ready, o.mode);
  const pbr = o.pbr ?? false;
  const imageType = o.imageType ?? "real";
  const key = productMeshKey({ image: o.image, modelId, pbr, imageType, meshResolution: o.meshResolution });
  const dir = o.cacheDir ?? defaultCacheDir();
  const glbPath = path.resolve(dir, `${key}.glb`);
  const metaPath = path.resolve(dir, `${key}.json`);

  const hit = await readCached(glbPath, metaPath);
  if (hit) return { glbPath, modelId, cached: true, costUsd: 0, key, ...hit };

  const knobs = FAL_KNOBS[modelId];
  if (!knobs?.image) throw new ProductMeshError(`No request schema for ${modelId}. Run node scripts/verify-models.mjs --write-snapshot`, "no_schema");
  const body = buildFalBody(knobs, "", { firstFrame: o.image });
  // Fields below are Idol's own, read from its OpenAPI schema; props are rigid, so rig stays off (fal warns they get an unusable skeleton).
  Object.assign(body, { image_type: imageType, enable_pbr: pbr });
  if (o.meshResolution !== undefined) body.mesh_resolution = o.meshResolution;

  const out = ((await (o.run ?? falRun)(modelId, body)) ?? {}) as { game_glb?: { url?: string }; mesh_stats?: { num_faces?: number } };
  const url = out.game_glb?.url;
  if (!url) throw new ProductMeshError(`${getModel(modelId)?.label ?? modelId} returned no game_glb mesh`, "no_mesh");
  const buf = await (o.download ?? fetchBuffer)(url);
  if (!isGlb(buf)) throw new ProductMeshError("The downloaded file is not a GLB, so it was not cached", "bad_mesh");

  await fs.mkdir(dir, { recursive: true });
  const tmp = `${glbPath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, buf);
  await fs.rename(tmp, glbPath);
  const triangles = out.mesh_stats?.num_faces;
  await fs.writeFile(metaPath, JSON.stringify({ modelId, createdAt: new Date().toISOString(), triangles, pbr, imageType, meshResolution: o.meshResolution ?? null }));
  const e = getModel(modelId);
  return { glbPath, modelId, cached: false, costUsd: e ? estimateUsd(e) : 0, key, bytes: buf.length, triangles };
}
