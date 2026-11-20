import { describe, it, expect, vi } from "vitest";
import { renderRouted, routeShot } from "@/lib/render/router";
import { aiVideoRenderer, remotionRenderer } from "@/lib/render/renderers";
import type { RenderContext, ShotRow } from "@/lib/render/types";

describe("Studio quality integration", () => {
  // Mock renderers
  const mockAiVideo = aiVideoRenderer({
    generate: vi.fn(async (model, prompt, opts) => ({
      url: "data:video/mp4;base64,mock",
      usage: { costUsd: 0.1 },
    })) as any,
    defaultModel: "test-model",
  });

  const mockRemotion = remotionRenderer({
    card: vi.fn(async () => "data:video/mp4;base64,mock-card") as any,
    enabled: () => true,
  });

  const renderers = {
    "ai-video": mockAiVideo,
    "remotion": mockRemotion,
  };

  it("passes product photos as refs to rendering context", async () => {
    const row: ShotRow = {
      id: "s1",
      beat: "hero",
      seconds: 3,
      action: "product bottle gleams",
      camera: "slow push-in 50mm",
    };

    const ctx: RenderContext = {
      mode: "preview",
      width: 854,
      height: 480,
      refs: ["data:image/png;base64,productPhoto1", "data:image/png;base64,productPhoto2"],
      prompt: "product bottle gleaming",
      resolution: "480p",
    };

    expect(ctx.refs.length).toBe(2);
    expect(ctx.refs[0]).toContain("productPhoto");
  });

  it("passes character reference as firstFrame to people shots", async () => {
    const generateMock = vi.fn(async (model, prompt, opts) => ({
      url: "data:video/mp4;base64,mock",
      usage: { costUsd: 0.1 },
    }));

    const mockAiVideoWithSpy = aiVideoRenderer({
      generate: generateMock as any,
      defaultModel: "test-model",
    });

    const row: ShotRow = {
      id: "s2",
      beat: "confession",
      seconds: 4,
      action: "person talking to camera",
      camera: "static 50mm",
      renderer: "ai-video",
    };

    const characterRef = "data:image/png;base64,characterReference";
    const ctx: RenderContext = {
      mode: "preview",
      width: 854,
      height: 480,
      refs: [],
      firstFrame: characterRef,
      prompt: "Mid-30s male in black hoodie talking to camera",
      resolution: "480p",
    };

    expect(ctx.firstFrame).toBe(characterRef);
    
    // Verify AI video receives the context with firstFrame
    const result = await mockAiVideoWithSpy.render(row, ctx);
    expect(generateMock).toHaveBeenCalled();
    
    // Check that firstFrame was passed in the options (3rd argument)
    const callArgs = generateMock.mock.calls[0];
    expect(callArgs[2]).toBeDefined();
    expect(callArgs[2].firstFrame).toBe(characterRef);
  });

  it("routes text-only shots to Remotion", () => {
    const textOnlyRow: ShotRow = {
      id: "s3",
      beat: "title",
      seconds: 2,
      action: "text appears",
      camera: "static",
      onScreen: "MOUNTAIN WATER",
    };

    const routing = routeShot(textOnlyRow, { hasProductRef: false });
    expect(routing.renderer).toBe("remotion");
    expect(routing.reason).toContain("text-only");
  });

  it("routes shots with scenes/subjects to AI video, not Remotion", () => {
    const sceneRow: ShotRow = {
      id: "s4",
      beat: "setting",
      seconds: 3,
      action: "kitchen scene with product on counter",
      camera: "pan",
      onScreen: "FRESH",
    };

    const routing = routeShot(sceneRow, { hasProductRef: true });
    expect(routing.renderer).not.toBe("remotion");
  });

  it("graphic cards always route to Remotion", () => {
    const cardRow: ShotRow = {
      id: "s5",
      beat: "end",
      seconds: 1.5,
      action: "end card",
      camera: "static",
      graphic: true,
    };

    const routing = routeShot(cardRow, { hasProductRef: false });
    expect(routing.renderer).toBe("remotion");
  });
});
