import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultFor, getModel, resolvePick, sanitizePicks } from "@/lib/registry";
import { FAL_KNOBS } from "@/lib/registry/fal-snapshot";
import { PRODUCT_3D_QUALITY, PRODUCT_3D_TURBO, ProductMeshError, classifyProduct, generateProductMesh, pickProductMeshModel, productMeshKey } from "@/lib/registry/product-3d";
import { autoPick } from "@/lib/registry/route";

// A mocked provider: nothing here reaches fal, so nothing here costs money.
const GLB = Buffer.concat([Buffer.from("glTF"), Buffer.alloc(32, 1)]);
const PHOTO = `data:image/png;base64,${Buffer.from("fake-png-bytes").toString("base64")}`;
let dir: string;
let calls: { endpoint: string; body: Record<string, unknown> }[];
const run = async (endpoint: string, body: Record<string, unknown>) => {
  calls.push({ endpoint, body });
  return { game_glb: { url: "https://v3b.fal.media/files/x/mesh.glb" }, model_glb: { url: "https://v3b.fal.media/files/x/vertex-colour.glb" }, mesh_stats: { num_faces: 30000 } };
};
const base = () => ({ image: PHOTO, run, download: async () => GLB, ready: () => true, cacheDir: dir });

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "p3d-"));
  calls = [];
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("product 3D asset: registry", () => {
  it("registers both Idol endpoints as runnable image-to-3D models at fal's listed prices", () => {
    for (const [id, usd] of [[PRODUCT_3D_TURBO, 0.1], [PRODUCT_3D_QUALITY, 0.2]] as const) {
      const e = getModel(id)!;
      expect(e.provider).toBe("fal");
      expect(e.stages).toEqual(["asset3d"]);
      expect(e.runnable).toBe(true);
      expect(e.caps.threeD).toBe(true);
      expect(e.cost.usd).toBe(usd);
      expect(e.verify.source).toBe("fal");
    }
  });

  it("derives the request from fal's real schema: one image_url field, no prompt", () => {
    for (const id of [PRODUCT_3D_TURBO, PRODUCT_3D_QUALITY]) {
      expect(FAL_KNOBS[id], id).toBeDefined();
      expect(FAL_KNOBS[id].image).toBe("image_url");
      expect(FAL_KNOBS[id].text).toBeUndefined();
    }
  });

  it("makes Auto Idol Max for finals and Turbo for previews, with Max as the stage default, and lets the picker store Auto", () => {
    expect(defaultFor("asset3d")).toBe(PRODUCT_3D_QUALITY);
    expect(pickProductMeshModel("auto", () => true, "final")).toBe(PRODUCT_3D_QUALITY);
    expect(pickProductMeshModel(undefined, () => true)).toBe(PRODUCT_3D_QUALITY);
    expect(pickProductMeshModel("auto", () => true, "preview")).toBe(PRODUCT_3D_TURBO);
    expect(pickProductMeshModel(PRODUCT_3D_TURBO, () => true, "final")).toBe(PRODUCT_3D_TURBO);
    expect(sanitizePicks({ asset3d: "auto" })).toEqual({ asset3d: "auto" });
    expect(resolvePick({ asset3d: PRODUCT_3D_TURBO }, "asset3d")).toBe(PRODUCT_3D_TURBO);
  });

  it("falls back to the other Idol model when one is not connected, and refuses models that are not image-to-3D", () => {
    expect(pickProductMeshModel("auto", (id) => id === PRODUCT_3D_QUALITY, "preview")).toBe(PRODUCT_3D_QUALITY);
    expect(pickProductMeshModel("auto", (id) => id === PRODUCT_3D_TURBO, "final")).toBe(PRODUCT_3D_TURBO);
    expect(() => pickProductMeshModel("auto", () => false)).toThrow(ProductMeshError);
    expect(() => pickProductMeshModel("anthropic/claude-sonnet-5.5", () => true)).toThrow(/not an image-to-3D/);
  });
});

describe("product 3D asset: generateProductMesh", () => {
  it("sends the photo to Idol Max for a final (Turbo for a preview) with fal's fields and caches the game-ready GLB", async () => {
    const m = await generateProductMesh(base());
    expect(m.modelId).toBe(PRODUCT_3D_QUALITY);
    expect(m.cached).toBe(false);
    expect(m.costUsd).toBe(0.2);
    expect(m.triangles).toBe(30000);
    expect(fs.readFileSync(m.glbPath).equals(GLB)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].endpoint).toBe(PRODUCT_3D_QUALITY);
    expect(calls[0].body).toMatchObject({ image_url: PHOTO, image_type: "real", enable_pbr: false });
    expect(calls[0].body).not.toHaveProperty("rig");
    expect(calls[0].body).not.toHaveProperty("prompt");
  });

  it("uses game_glb (textured), never the vertex-coloured model_glb", async () => {
    let fetched = "";
    await generateProductMesh({ ...base(), download: async (u) => { fetched = u; return GLB; } });
    expect(fetched).toMatch(/mesh\.glb$/);
  });

  it("returns the cached mesh for the same photo with no second call and no cost", async () => {
    const a = await generateProductMesh(base());
    const b = await generateProductMesh(base());
    expect(b.cached).toBe(true);
    expect(b.costUsd).toBe(0);
    expect(b.glbPath).toBe(a.glbPath);
    expect(b.triangles).toBe(30000);
    expect(calls).toHaveLength(1);
  });

  it("hashes image bytes, model and options, so any change makes a new mesh", async () => {
    await generateProductMesh(base());
    await generateProductMesh({ ...base(), mode: "preview" });
    await generateProductMesh({ ...base(), pbr: true });
    await generateProductMesh({ ...base(), image: `data:image/jpeg;base64,${Buffer.from("other").toString("base64")}` });
    expect(calls.map((c) => c.endpoint)).toEqual([PRODUCT_3D_QUALITY, PRODUCT_3D_TURBO, PRODUCT_3D_QUALITY, PRODUCT_3D_QUALITY]);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".glb"))).toHaveLength(4);
  });

  it("keys the same bytes the same way whatever the data URL's mime type", () => {
    const o = { modelId: PRODUCT_3D_QUALITY, pbr: false, imageType: "real" };
    const bytes = Buffer.from("same").toString("base64");
    expect(productMeshKey({ ...o, image: `data:image/png;base64,${bytes}` })).toBe(productMeshKey({ ...o, image: `data:image/jpeg;base64,${bytes}` }));
  });

  it("passes pbr, image type and mesh resolution through, and rejects values the schema does not allow", async () => {
    await generateProductMesh({ ...base(), pbr: true, imageType: "synthetic", meshResolution: 512 });
    expect(calls[0].body).toMatchObject({ enable_pbr: true, image_type: "synthetic", mesh_resolution: 512 });
    await expect(generateProductMesh({ ...base(), meshResolution: 999 })).rejects.toThrow(/mesh_resolution/);
  });

  it("fails clearly, and caches nothing, when the input or the output is wrong", async () => {
    await expect(generateProductMesh({ ...base(), image: "not a url" })).rejects.toMatchObject({ code: "bad_input" });
    await expect(generateProductMesh({ ...base(), run: async () => ({ model_glb: { url: "https://x/y.glb" } }) })).rejects.toMatchObject({ code: "no_mesh" });
    await expect(generateProductMesh({ ...base(), download: async () => Buffer.from("<html>error</html>") })).rejects.toMatchObject({ code: "bad_mesh" });
    await expect(generateProductMesh({ ...base(), ready: () => false })).rejects.toMatchObject({ code: "no_model" });
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("re-fetches when a cached file is not a GLB", async () => {
    const a = await generateProductMesh(base());
    fs.writeFileSync(a.glbPath, "corrupt");
    const b = await generateProductMesh(base());
    expect(b.cached).toBe(false);
    expect(calls).toHaveLength(2);
  });
});

describe("product 3D asset: which products get a mesh", () => {
  it("sends simple primitives to the Blender primitive and irregular products to Idol", () => {
    for (const k of ["energy drink can", "glass bottle", "cereal box", "toothpaste tube", "sparkling soda", "toy in a box"]) expect(classifyProduct(k), k).toBe("primitive");
    for (const k of ["running shoe", "plush toy", "wireless headphones", "robot character", "leather backpack"]) expect(classifyProduct(k), k).toBe("irregular");
    for (const k of [undefined, "", "mystery item"]) expect(classifyProduct(k), String(k)).toBe("unknown");
  });
});

describe("product 3D asset: routing", () => {
  const shot = { id: "s1", seconds: 3, action: "hero product shot on a glossy floor", camera: "slow orbit", engine: "blender" as const, engineLocked: true };
  const ctx = { mode: "final" as const, hasProductRef: true, hasKeyframe: false, ready: () => true, productKind: "running shoe" };

  it("plans Idol Max for an irregular product in a final and Turbo in a preview", () => {
    const p = autoPick(shot, ctx);
    expect(p.renderer).toBe("blender");
    expect(p.usd).toBe(0);
    expect(p.mesh).toEqual({ modelId: PRODUCT_3D_QUALITY, usd: 0.2 });
    expect(autoPick(shot, { ...ctx, mode: "preview" }).mesh).toEqual({ modelId: PRODUCT_3D_TURBO, usd: 0.1 });
    expect(autoPick(shot, { ...ctx, meshModel: PRODUCT_3D_TURBO }).mesh?.modelId).toBe(PRODUCT_3D_TURBO);
  });

  it("plans no mesh for a can, bottle or box, or an unclassified product: the free primitive with the label wrapped", () => {
    for (const productKind of ["energy drink can", "wine bottle", "cereal box", undefined, "mystery item"]) {
      const p = autoPick(shot, { ...ctx, productKind });
      expect(p.renderer).toBe("blender");
      expect(p.mesh, String(productKind)).toBeUndefined();
    }
  });

  it("plans no mesh without a product photo or when no 3D model is connected", () => {
    expect(autoPick(shot, { ...ctx, hasProductRef: false }).mesh).toBeUndefined();
    expect(autoPick(shot, { ...ctx, ready: () => false }).mesh).toBeUndefined();
  });
});
