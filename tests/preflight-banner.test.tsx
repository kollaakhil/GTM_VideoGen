import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PreflightBanner } from "@/components/sheet-studio/preflight-banner";
import "@testing-library/jest-dom/vitest";

describe("PreflightBanner", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows nothing when preflight passes", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        errors: [],
        warnings: [],
        checked: 45,
      }),
    });

    const { container } = render(<PreflightBanner />);

    await waitFor(() => {
      expect(container.innerHTML).toBe("");
    });
  });

  it("shows banner with errors when preflight fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        errors: [
          "anthropic/claude-sonnet-5.5: MODALITY MISMATCH - text model in image role (expected image)",
          "fal-ai/mmaudio-v2: DEPRECATED (410)",
        ],
        warnings: ["some-model: Possible modality mismatch"],
        checked: 45,
      }),
    });

    render(<PreflightBanner />);

    await waitFor(() => {
      expect(screen.getByText("Model Validation Issues")).toBeInTheDocument();
    });

    expect(screen.getByText(/2 models failed validation/)).toBeInTheDocument();
    expect(screen.getByText(/anthropic\/claude-sonnet-5.5: MODALITY MISMATCH/)).toBeInTheDocument();
    expect(screen.getByText(/fal-ai\/mmaudio-v2: DEPRECATED/)).toBeInTheDocument();
  });

  it("shows truncated errors when more than 5", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        errors: [
          "model1: ERROR",
          "model2: ERROR",
          "model3: ERROR",
          "model4: ERROR",
          "model5: ERROR",
          "model6: ERROR",
          "model7: ERROR",
        ],
        warnings: [],
        checked: 50,
      }),
    });

    render(<PreflightBanner />);

    await waitFor(() => {
      expect(screen.getByText("Model Validation Issues")).toBeInTheDocument();
    });

    expect(screen.getByText(/\+ 2 more errors/)).toBeInTheDocument();
  });

  it("shows warnings section when present", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        errors: ["model1: ERROR"],
        warnings: ["model2: WARNING", "model3: WARNING"],
        checked: 45,
      }),
    });

    render(<PreflightBanner />);

    await waitFor(() => {
      expect(screen.getByText("Warnings:")).toBeInTheDocument();
    });

    expect(screen.getByText("model2: WARNING")).toBeInTheDocument();
    expect(screen.getByText("model3: WARNING")).toBeInTheDocument();
  });

  it("can be dismissed", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: false,
        errors: ["model1: ERROR"],
        warnings: [],
        checked: 45,
      }),
    });

    const { container } = render(<PreflightBanner />);

    await waitFor(() => {
      expect(screen.getByText("Model Validation Issues")).toBeInTheDocument();
    });

    const dismissButton = screen.getByRole("button", { name: "Dismiss" });
    dismissButton.click();

    await waitFor(() => {
      expect(container.innerHTML).toBe("");
    });
  });

  it("handles fetch errors gracefully", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const { container } = render(<PreflightBanner />);

    await waitFor(() => {
      expect(container.innerHTML).toBe("");
    });
  });
});
