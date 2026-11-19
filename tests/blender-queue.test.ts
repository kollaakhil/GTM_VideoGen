import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { BlenderQueue } from "@/lib/render/blender-queue";
import { ChildProcess } from "node:child_process";

describe("BlenderQueue", () => {
  let queue: BlenderQueue;

  beforeEach(() => {
    queue = new BlenderQueue(1);
  });

  afterEach(() => {
    queue.cleanup(0);
  });

  describe("queue order and priority", () => {
    it("processes jobs in FIFO order when all have normal priority", async () => {
      const order: string[] = [];

      const job1 = queue.enqueue({
        id: "job1",
        runId: "run1",
        versionId: "v1",
        shotId: "shot1",
        priority: "normal",
      }).then(() => order.push("job1"));

      const job2 = queue.enqueue({
        id: "job2",
        runId: "run1",
        versionId: "v1",
        shotId: "shot2",
        priority: "normal",
      }).then(() => order.push("job2"));

      const job3 = queue.enqueue({
        id: "job3",
        runId: "run1",
        versionId: "v1",
        shotId: "shot3",
        priority: "normal",
      }).then(() => order.push("job3"));

      // Simulate jobs finishing
      queue.finish("job1");
      await Promise.resolve();
      queue.finish("job2");
      await Promise.resolve();
      queue.finish("job3");

      await Promise.all([job1, job2, job3]);
      expect(order).toEqual(["job1", "job2", "job3"]);
    });

    it("prioritizes high priority jobs over normal priority", async () => {
      const order: string[] = [];

      // Start first job
      const job1 = queue.enqueue({
        id: "job1",
        runId: "run1",
        versionId: "v1",
        shotId: "shot1",
        priority: "normal",
      }).then(() => order.push("job1"));

      // Queue normal and high priority jobs
      const job2 = queue.enqueue({
        id: "job2",
        runId: "run1",
        versionId: "v1",
        shotId: "shot2",
        priority: "normal",
      }).then(() => order.push("job2"));

      const job3 = queue.enqueue({
        id: "job3",
        runId: "run2",
        versionId: "v2",
        shotId: "shot3",
        priority: "high",
      }).then(() => order.push("job3"));

      // job1 finishes, job3 (high priority) should go next
      queue.finish("job1");
      await Promise.resolve();
      queue.finish("job3");
      await Promise.resolve();
      queue.finish("job2");

      await Promise.all([job1, job2, job3]);
      expect(order).toEqual(["job1", "job3", "job2"]);
    });
  });

  describe("queue position reporting", () => {
    it("reports correct position in queue", async () => {
      const job1Promise = queue.enqueue({
        id: "job1",
        runId: "run1",
        versionId: "v1",
        shotId: "shot1",
        priority: "normal",
      });

      const job2Promise = queue.enqueue({
        id: "job2",
        runId: "run1",
        versionId: "v1",
        shotId: "shot2",
        priority: "normal",
      });

      const job3Promise = queue.enqueue({
        id: "job3",
        runId: "run1",
        versionId: "v1",
        shotId: "shot3",
        priority: "normal",
      });

      expect(queue.getPosition("job1")).toBeNull(); // running
      expect(queue.getPosition("job2")).toBe(1);
      expect(queue.getPosition("job3")).toBe(2);

      queue.finish("job1");
      await Promise.resolve();

      expect(queue.getPosition("job2")).toBeNull(); // now running
      expect(queue.getPosition("job3")).toBe(1);

      queue.finish("job2");
      await Promise.resolve();
      queue.finish("job3");
      
      await Promise.all([job1Promise, job2Promise, job3Promise]);
    });

    it("returns null position for non-waiting jobs", () => {
      const jobId = "job1";
      expect(queue.getPosition(jobId)).toBeNull();

      queue.enqueue({
        id: jobId,
        runId: "run1",
        versionId: "v1",
        shotId: "shot1",
        priority: "normal",
      });

      expect(queue.getPosition(jobId)).toBeNull(); // running immediately
      queue.finish(jobId);
    });
  });

  describe("cancel functionality", () => {
    it("removes waiting jobs from queue", async () => {
      const job1Promise = queue.enqueue({
        id: "job1",
        runId: "run1",
        versionId: "v1",
        shotId: "shot1",
        priority: "normal",
      });

      const job2Promise = queue.enqueue({
        id: "job2",
        runId: "run1",
        versionId: "v1",
        shotId: "shot2",
        priority: "normal",
      }).catch((e) => e.message);

      const job3Promise = queue.enqueue({
        id: "job3",
        runId: "run1",
        versionId: "v1",
        shotId: "shot3",
        priority: "normal",
      });

      queue.cancel("job2");

      const job2Result = await job2Promise;
      expect(job2Result).toBe("Job was cancelled");

      const job2State = queue.getAll().find((j) => j.id === "job2");
      expect(job2State?.state).toBe("cancelled");

      queue.finish("job1");
      await Promise.resolve();
      queue.finish("job3");

      await job1Promise;
      await job3Promise;
    });

    it("kills the running job's process", async () => {
      const mockProcess = {
        kill: vi.fn(),
        killed: false,
      } as unknown as ChildProcess;

      const jobPromise = queue.enqueue({
        id: "job1",
        runId: "run1",
        versionId: "v1",
        shotId: "shot1",
        priority: "normal",
      });

      queue.setProcess("job1", mockProcess);
      queue.cancel("job1");

      expect(mockProcess.kill).toHaveBeenCalledWith("SIGTERM");

      const job = queue.getAll().find((j) => j.id === "job1");
      expect(job?.state).toBe("cancelled");

      await jobPromise.catch(() => {});
    });

    it("aborts AI controller when job is cancelled", () => {
      const mockController = new AbortController();
      const abortSpy = vi.spyOn(mockController, "abort");

      queue.enqueue({
        id: "job1",
        runId: "run1",
        versionId: "v1",
        shotId: "shot1",
        priority: "normal",
      });

      queue.setAbortController("job1", mockController);
      queue.cancel("job1");

      expect(abortSpy).toHaveBeenCalled();
    });

    it("cancels all jobs for a run", async () => {
      await queue.enqueue({
        id: "job1",
        runId: "run1",
        versionId: "v1",
        shotId: "shot1",
        priority: "normal",
      });

      const job2Promise = queue.enqueue({
        id: "job2",
        runId: "run1",
        versionId: "v1",
        shotId: "shot2",
        priority: "normal",
      }).catch((e) => e.message);

      const job3Promise = queue.enqueue({
        id: "job3",
        runId: "run2",
        versionId: "v2",
        shotId: "shot3",
        priority: "normal",
      });

      queue.cancelRun("run1");

      await expect(job2Promise).resolves.toBe("Job was cancelled");
      
      const jobs = queue.getAll();
      expect(jobs.find((j) => j.id === "job1")?.state).toBe("cancelled");
      
      // job3 from run2 should have started after job1 was cancelled
      expect(jobs.find((j) => j.id === "job3")?.state).toBe("running");

      queue.finish("job3");
      await job3Promise;
    });

    it("cancels all jobs for a version", async () => {
      await queue.enqueue({
        id: "job1",
        runId: "run1",
        versionId: "v1",
        shotId: "shot1",
        priority: "normal",
      });

      const job2Promise = queue.enqueue({
        id: "job2",
        runId: "run1",
        versionId: "v1",
        shotId: "shot2",
        priority: "normal",
      }).catch((e) => e.message);

      const job3Promise = queue.enqueue({
        id: "job3",
        runId: "run1",
        versionId: "v2",
        shotId: "shot3",
        priority: "normal",
      });

      queue.cancelVersion("v1");

      await expect(job2Promise).resolves.toBe("Job was cancelled");

      const jobs = queue.getAll();
      expect(jobs.find((j) => j.id === "job1")?.state).toBe("cancelled");

      // job3 from v2 should have started after job1 was cancelled
      expect(jobs.find((j) => j.id === "job3")?.state).toBe("running");

      queue.finish("job3");
      await job3Promise;
    });
  });

  describe("superseded auto-cancel", () => {
    it("auto-cancels earlier queued jobs for the same version", async () => {
      await queue.enqueue({
        id: "job1",
        runId: "run1",
        versionId: "v1",
        shotId: "shot1",
        priority: "normal",
      });

      const job2Promise = queue.enqueue({
        id: "job2",
        runId: "run1",
        versionId: "v1",
        shotId: "shot2",
        priority: "normal",
      }).catch((e) => e.message);

      const job3Promise = queue.enqueue({
        id: "job3",
        runId: "run1",
        versionId: "v1",
        shotId: "shot3",
        priority: "normal",
      });

      // New job for same run+version auto-cancels waiting jobs
      queue.autoCancel("run1", "v1", "job4");

      await expect(job2Promise).resolves.toBe("Job was cancelled");
      
      const jobs = queue.getAll();
      expect(jobs.find((j) => j.id === "job2")?.state).toBe("cancelled");
      expect(jobs.find((j) => j.id === "job3")?.state).toBe("cancelled");

      queue.finish("job1");
      await job3Promise.catch(() => {});
    });

    it("does not cancel the current job", async () => {
      const jobPromise = queue.enqueue({
        id: "job1",
        runId: "run1",
        versionId: "v1",
        shotId: "shot1",
        priority: "normal",
      });

      queue.autoCancel("run1", "v1", "job1");

      const job = queue.getAll().find((j) => j.id === "job1");
      expect(job?.state).toBe("running");

      queue.finish("job1");
      await jobPromise;
    });

    it("only cancels waiting jobs, not running ones", async () => {
      await queue.enqueue({
        id: "job1",
        runId: "run1",
        versionId: "v1",
        shotId: "shot1",
        priority: "normal",
      });

      const job2Promise = queue.enqueue({
        id: "job2",
        runId: "run1",
        versionId: "v1",
        shotId: "shot2",
        priority: "normal",
      }).catch((e) => e.message);

      queue.autoCancel("run1", "v1", "job3");

      const jobs = queue.getAll();
      // job1 is running, should not be cancelled
      expect(jobs.find((j) => j.id === "job1")?.state).toBe("running");
      // job2 is waiting, should be cancelled
      await expect(job2Promise).resolves.toBe("Job was cancelled");

      queue.finish("job1");
    });
  });

  describe("409 guard release after cancel", () => {
    it("releases slot after cancel", async () => {
      const job1Promise = queue.enqueue({
        id: "job1",
        runId: "run1",
        versionId: "v1",
        shotId: "shot1",
        priority: "normal",
      });

      const job2Promise = queue.enqueue({
        id: "job2",
        runId: "run1",
        versionId: "v1",
        shotId: "shot2",
        priority: "normal",
      });

      queue.cancel("job1");

      // After cancelling running job, next job should start
      await Promise.resolve();
      
      const jobs = queue.getAll();
      expect(jobs.find((j) => j.id === "job2")?.state).toBe("running");

      queue.finish("job2");
      await job1Promise.catch(() => {});
      await job2Promise;
    });
  });

  describe("preview spec quality settings", () => {
    it("generates preview mode spec JSON with lower samples for Blender", async () => {
      const { kitJob } = await import("@/lib/render/blender-kit");
      
      const job = kitJob(
        { id: "s1", n: 1, start: 0, end: 3, shotType: "product", framing: "", camera: { lensMm: 50, move: "static", angle: "straight-on" }, subject: "Product bottle", action: "", lighting: "", text: null, audio: { vo: null, sfx: null, music: null }, transition: "cut", engine: "blender", engineLocked: false, blender: { template: "product_hero", word: undefined, label: undefined, ignite: undefined }, editorNote: "" },
        { palette: "#ff3b1d" },
        { width: 854, height: 480, mode: "preview", blender: { template: "product_hero", word: undefined, label: undefined, ignite: undefined } }
      );
      
      expect(job.spec.mode).toBe("preview");
      expect(job.spec.samples).toBe(8);
      expect(job.spec.width).toBeLessThanOrEqual(854);
      expect(job.spec.height).toBeLessThanOrEqual(480);
    });

    it("generates final mode spec JSON with full samples for Blender", async () => {
      const { kitJob } = await import("@/lib/render/blender-kit");
      
      const job = kitJob(
        { id: "s1", n: 1, start: 0, end: 3, shotType: "product", framing: "", camera: { lensMm: 50, move: "static", angle: "straight-on" }, subject: "Product bottle", action: "", lighting: "", text: null, audio: { vo: null, sfx: null, music: null }, transition: "cut", engine: "blender", engineLocked: false, blender: { template: "product_hero", word: undefined, label: undefined, ignite: undefined }, editorNote: "" },
        { palette: "#ff3b1d" },
        { width: 1280, height: 720, mode: "final", blender: { template: "product_hero", word: undefined, label: undefined, ignite: undefined } }
      );
      
      expect(job.spec.mode).toBe("final");
      expect(job.spec.samples).toBe(16);
      expect(job.spec.width).toBeLessThanOrEqual(1280);
      expect(job.spec.height).toBeLessThanOrEqual(720);
    });

    it("generates lab scene spec with higher samples for final mode", async () => {
      const { kitJob } = await import("@/lib/render/blender-kit");
      
      const job = kitJob(
        { id: "s1", n: 1, start: 0, end: 3, shotType: "product", framing: "", camera: { lensMm: 50, move: "static", angle: "straight-on" }, subject: "Lab scene", action: "", lighting: "", text: null, audio: { vo: null, sfx: null, music: null }, transition: "cut", engine: "blender", engineLocked: false, blender: { template: "lab", word: undefined, label: "Test Label", ignite: undefined }, editorNote: "" },
        { palette: "#ff3b1d" },
        { width: 1280, height: 720, mode: "final", blender: { template: "lab", word: undefined, label: "Test Label", ignite: undefined } }
      );
      
      expect(job.spec.mode).toBe("final");
      expect(job.spec.samples).toBe(24); // Lab scene uses 24 samples for final
      expect(job.script).toBe("scene_kit.py");
    });
  });

  describe("hasActive", () => {
    it("returns true when jobs are running or waiting", async () => {
      expect(queue.hasActive()).toBe(false);

      await queue.enqueue({
        id: "job1",
        runId: "run1",
        versionId: "v1",
        shotId: "shot1",
        priority: "normal",
      });

      expect(queue.hasActive()).toBe(true);

      queue.finish("job1");
      expect(queue.hasActive()).toBe(false);
    });

    it("returns false after all jobs complete", async () => {
      const job1 = queue.enqueue({
        id: "job1",
        runId: "run1",
        versionId: "v1",
        shotId: "shot1",
        priority: "normal",
      });

      const job2 = queue.enqueue({
        id: "job2",
        runId: "run1",
        versionId: "v1",
        shotId: "shot2",
        priority: "normal",
      });

      expect(queue.hasActive()).toBe(true);

      queue.finish("job1");
      await Promise.resolve();
      expect(queue.hasActive()).toBe(true);

      queue.finish("job2");
      await Promise.all([job1, job2]);
      expect(queue.hasActive()).toBe(false);
    });
  });

  describe("cleanup", () => {
    it("removes old finished jobs", async () => {
      const jobPromise = queue.enqueue({
        id: "job1",
        runId: "run1",
        versionId: "v1",
        shotId: "shot1",
        priority: "normal",
      });

      queue.finish("job1");
      await jobPromise;

      expect(queue.getAll()).toHaveLength(1);

      // Wait a tick to ensure finishedAt is in the past
      await new Promise((r) => setTimeout(r, 10));
      
      queue.cleanup(0); // remove immediately

      expect(queue.getAll()).toHaveLength(0);
    });

    it("keeps recent finished jobs", async () => {
      const jobPromise = queue.enqueue({
        id: "job1",
        runId: "run1",
        versionId: "v1",
        shotId: "shot1",
        priority: "normal",
      });

      queue.finish("job1");
      await jobPromise;

      queue.cleanup(60 * 60 * 1000); // keep for an hour

      expect(queue.getAll()).toHaveLength(1);
    });
  });
});
