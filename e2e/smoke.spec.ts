import { expect, test } from "@playwright/test";

test("homepage and health endpoint are available", async ({ page, request }) => {
  const documentResponse = await request.get("/");
  expect(documentResponse.status()).toBe(200);
  expect(documentResponse.headers()["content-type"]).toContain("text/html");
  expect(documentResponse.headers()["content-security-policy"]).toContain("default-src 'self'");
  expect(documentResponse.headers()["x-content-type-options"]).toBe("nosniff");
  expect(documentResponse.headers()["x-frame-options"]).toBe("DENY");
  expect(documentResponse.headers()["referrer-policy"]).toBe("no-referrer");

  await page.goto("/");

  await expect(page).toHaveTitle("问思学伴 ThinkTutor");
  await expect(
    page.getByRole("heading", { name: "问思学伴" }),
  ).toBeVisible();
  await expect(page.getByText("本地成果预览已就绪")).toHaveCount(0);
  await expect(page.getByText("student@example.test")).toHaveCount(0);

  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toEqual({
    ok: true,
    service: "thinktutor",
  });
  expect(response.headers()["cache-control"]).toContain("no-store");
});
