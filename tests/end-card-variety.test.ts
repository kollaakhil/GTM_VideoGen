import { describe, expect, it } from "vitest";
import { selectEndCardLayout } from "@/../remotion/EndCardLayouts";

describe("End-card variety", () => {
  it("selects hero layout for bold dramatic concepts with product photo", () => {
    const concept = {
      visualWorld: "bold and dramatic",
      tone: "powerful",
      setting: "studio",
    };
    
    const layout = selectEndCardLayout(concept, true);
    expect(layout).toBe("hero");
  });

  it("selects split layout for clean professional concepts with product photo", () => {
    const concept = {
      visualWorld: "clean and minimal",
      tone: "professional",
      setting: "studio background",
    };
    
    const layout = selectEndCardLayout(concept, true);
    expect(layout).toBe("split");
  });

  it("selects minimal layout for understated concepts", () => {
    const concept = {
      visualWorld: "elegant and subtle",
      tone: "calm",
      setting: "quiet room",
    };
    
    const layout = selectEndCardLayout(concept, false);
    expect(layout).toBe("minimal");
  });

  it("defaults to classic layout for generic concepts", () => {
    const concept = {
      visualWorld: "everyday life",
      tone: "casual",
      setting: "home",
    };
    
    const layout = selectEndCardLayout(concept, true);
    expect(layout).toBe("classic");
  });

  it("defaults to classic when no concept provided", () => {
    const layout = selectEndCardLayout(null, true);
    expect(layout).toBe("classic");
  });

  it("defaults to classic when concept has no relevant keywords", () => {
    const concept = {
      visualWorld: "random world",
      tone: "neutral",
      setting: "anywhere",
    };
    
    const layout = selectEndCardLayout(concept, false);
    expect(layout).toBe("classic");
  });

  it("prefers hero over split when both keywords present", () => {
    const concept = {
      visualWorld: "clean hero shot",
      tone: "bold",
      setting: "studio",
    };
    
    const layout = selectEndCardLayout(concept, true);
    expect(layout).toBe("hero"); // Hero comes first in the selector
  });

  it("falls back when no product photo and split/hero would be chosen", () => {
    const concept = {
      visualWorld: "bold dramatic",
      tone: "powerful",
      setting: "studio",
    };
    
    // Without product photo, hero layout can't be used effectively
    const layout = selectEndCardLayout(concept, false);
    // Should fall through to classic
    expect(layout).toBe("classic");
  });
});
