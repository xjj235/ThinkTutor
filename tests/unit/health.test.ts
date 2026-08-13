import { GET } from "@/app/api/health/route";

describe("health route", () => {
  it("returns a stable service status", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "thinktutor",
    });
  });
});
