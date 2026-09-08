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

  it.each([1, 2] as const)("holds the lock for %s sequential calls per attempt and releases it", async (calls) => {
    const release = vi.fn(async () => undefined);
    const lock = vi.spyOn(redis, "acquireLock").mockResolvedValue(release);
    expect(await withAIRequestProtection("student", "session", async () => "result", calls)).toBe("result");
    expect(lock).toHaveBeenCalledWith("lock:ai:session", 45_000 * calls * 3 + 10_000);
    expect(release).toHaveBeenCalledOnce();
  });

  it("releases after a rejected generation and rejects concurrent work", async () => {
    const release = vi.fn(async () => undefined);
    const lock = vi.spyOn(redis, "acquireLock").mockResolvedValueOnce(release).mockResolvedValueOnce(null);
    await expect(withAIRequestProtection("student", "session", async () => { throw new Error("review rejected"); }, 2)).rejects.toThrow("review rejected");
    expect(release).toHaveBeenCalledOnce();
    const work = vi.fn(async () => "not run");
    await expect(withAIRequestProtection("student", "session", work, 2)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(work).not.toHaveBeenCalled();
    expect(lock).toHaveBeenCalledTimes(2);
  });
});
