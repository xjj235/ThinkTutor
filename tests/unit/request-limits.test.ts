import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as redis from "@/lib/redis";
import { withAIRequestProtection } from "@/lib/request-limits";

describe("AI request lock covers sequential generation and review", () => {
  beforeEach(() => {
    vi.stubEnv("DEEPSEEK_TIMEOUT_MS", "45000");
    vi.stubEnv("AI_MAX_RETRIES", "2");
    vi.spyOn(redis, "consumeRateLimit").mockResolvedValue({ remaining: 100, resetAt: Date.now() + 60_000 });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it.each([1, 2, 3] as const)("holds the lock for %s sequential calls per attempt and releases it", async (calls) => {
    const release = vi.fn(async () => undefined);
    const lock = vi.spyOn(redis, "acquireLock").mockResolvedValue(release);
    expect(await withAIRequestProtection("student", "session", async () => "result", calls)).toBe("result");
    expect(lock).toHaveBeenCalledWith("lock:ai:session", 45_000 * calls * 3 + 10_000);
    expect(release).toHaveBeenCalledOnce();
  });

  it("budgets three sequential calls when retries are disabled", async () => {
    vi.stubEnv("AI_MAX_RETRIES", "0");
    const release = vi.fn(async () => undefined);
    const lock = vi.spyOn(redis, "acquireLock").mockResolvedValue(release);
    await withAIRequestProtection("student", "session", async () => "result", 3);
    expect(lock).toHaveBeenCalledWith("lock:ai:session", 145_000);
    expect(redis.consumeRateLimit).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledOnce();
  });

  it("releases a three-call budget after a review failure", async () => {
    const release = vi.fn(async () => undefined);
    const lock = vi.spyOn(redis, "acquireLock").mockResolvedValue(release);
    await expect(withAIRequestProtection("student", "session", async () => { throw new Error("review rejected"); }, 3)).rejects.toThrow("review rejected");
    expect(lock).toHaveBeenCalledWith("lock:ai:session", 415_000);
    expect(release).toHaveBeenCalledOnce();
  });

  it("keeps the three-call lock while review is pending and rejects concurrent work", async () => {
    const release = vi.fn(async () => undefined);
    const lock = vi.spyOn(redis, "acquireLock").mockResolvedValueOnce(release).mockResolvedValueOnce(null);
    let finishReview: ((value: string) => void) | undefined;
    const pendingReview = new Promise<string>((resolve) => { finishReview = resolve; });
    const review = vi.fn(() => pendingReview);
    const firstRequest = withAIRequestProtection("student", "session", review, 3);
    await vi.waitFor(() => expect(review).toHaveBeenCalledOnce());
    expect(release).not.toHaveBeenCalled();
    const work = vi.fn(async () => "not run");
    await expect(withAIRequestProtection("student", "session", work, 3)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(work).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(lock).toHaveBeenCalledTimes(2);
    expect(lock).toHaveBeenNthCalledWith(2, "lock:ai:session", 415_000);
    finishReview?.("reviewed");
    await expect(firstRequest).resolves.toBe("reviewed");
    expect(release).toHaveBeenCalledOnce();
  });
});
