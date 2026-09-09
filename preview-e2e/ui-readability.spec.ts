import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

type PageMeasure = { path: string; body: string; heading: string; horizontalOverflow: boolean };

const runtimeErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
});
test.afterEach(async ({ page }, info) => {
  const errors = runtimeErrors.get(page) ?? [];
  await writeFile(info.outputPath("runtime-errors.json"), JSON.stringify({ count: errors.length, errors }, null, 2));
  expect(errors).toEqual([]);
});

async function checkPage(page: Page, path: string): Promise<PageMeasure> {
  await expect(page.locator('.workspace-state[data-variant="loading"]')).toBeHidden();
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator("main h1")).toBeVisible();
  const measured = await page.evaluate(() => ({
    body: getComputedStyle(document.body).fontSize,
    heading: getComputedStyle(document.querySelector("main h1")!).fontSize,
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
  }));
  expect(measured.horizontalOverflow, path).toBe(false);
  expect(parseFloat(measured.body), path).toBeGreaterThanOrEqual(16);
  expect(parseFloat(measured.heading), path).toBeGreaterThanOrEqual(28);
  const sizes = await page.locator("main label, main input, main select, main textarea, .badge, .workspace-link, .review-tab-list button").evaluateAll(elements => elements
    .filter(element => element.getBoundingClientRect().height > 0)
    .map(element => ({ tag: element.tagName, badge: element.classList.contains("badge"), reading: Boolean(element.closest(".response-composer,.feynman-composer")), size: parseFloat(getComputedStyle(element).fontSize) })));
  for (const size of sizes) {
    expect(size.size, `${path}: ${size.tag}`).toBeGreaterThanOrEqual(size.badge ? 14 : 16);
    if (["INPUT", "SELECT", "TEXTAREA"].includes(size.tag)) expect(size.size, `${path}: input scale`).toBe(size.reading ? 18 : 16);
  }
  return { path, ...measured };
}

test("public pages retain readable text and the real visual asset", async ({ page }, info) => {
  test.setTimeout(120_000);
  const measures: PageMeasure[] = [];
  for (const path of ["/", "/login", "/register", "/about", "/privacy", "/terms"]) {
    await page.goto(path);
    measures.push(await checkPage(page, path));
    if (path === "/") {
      expect(await page.locator(".public-hero-image").evaluate(element => element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0)).toBe(true);
    }
    await page.screenshot({ path: info.outputPath(`${path.replaceAll("/", "_") || "home"}.png`), fullPage: false });
  }
  await writeFile(info.outputPath("readability.json"), JSON.stringify(measures, null, 2));
});

const roles = [
  { role: "student", entry: "/dashboard", routes: ["/dashboard", "/learn/new", "/assignments", "/classes", "/history", "/profile/learning", "/profile"] },
  { role: "teacher", entry: "/teacher", routes: ["/teacher", "/teacher/courses", "/teacher/courses/new", "/teacher/classes", "/teacher/assignments", "/teacher/assignments/new", "/teacher/knowledge", "/teacher/knowledge/claims"] },
  { role: "admin", entry: "/admin", routes: ["/admin", "/admin/users", "/admin/ai", "/admin/materials", "/admin/audit", "/admin/system"] },
];

for (const { role, entry, routes } of roles) {
  test(`${role} pages use the readable type scale and preserve top navigation`, async ({ page }, info) => {
    test.setTimeout(180_000);
    await page.goto(`/login?email=${role}%40example.test`);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${entry}$`));
    const measures: PageMeasure[] = [];
    const detailPages = new Map<string, string>();
    const patterns = [/^\/session\/[^/]+$/, /^\/report\/[^/]+$/, /^\/classes\/[^/]+$/, /^\/assignments\/[^/]+$/, /^\/teacher\/courses\/[^/]+$/, /^\/teacher\/classes\/[^/]+$/, /^\/teacher\/assignments\/[^/]+$/];
    for (const path of routes) {
      await page.goto(path);
      measures.push(await checkPage(page, path));
      const links = await page.locator("main a[href]").evaluateAll(nodes => nodes.map(node => node.getAttribute("href") ?? ""));
      for (const pattern of patterns) {
        const href = links.find(link => pattern.test(link) && !link.endsWith("/new"));
        if (href && !detailPages.has(pattern.source)) detailPages.set(pattern.source, href);
      }
      const header = await page.locator(".workspace-shell").boundingBox();
      const main = await page.locator("main").boundingBox();
      expect(main!.y).toBeGreaterThanOrEqual(header!.height);
      await expect(page.locator(".workspace-sidebar")).toHaveCount(0);
      if (path === "/learn/new") {
        await expect(page.getByRole("group", { name: "研习目标", exact: true })).toBeVisible();
        await expect(page.getByRole("group", { name: "补充资料", exact: true })).toBeVisible();
      }
      await page.screenshot({ path: info.outputPath(`${path.replaceAll("/", "_")}.png`), fullPage: false });
    }
    for (const path of detailPages.values()) {
      await page.goto(path);
      measures.push(await checkPage(page, path));
      if (path.startsWith("/session/")) {
        const text = page.locator(".learning-entry .safe-markdown").first();
        await expect(text).toBeVisible();
        expect(await text.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBe(18);
        const context = await page.locator(".learning-context").boundingBox();
        const record = await page.locator(".learning-record").boundingBox();
        expect(record!.y).toBeGreaterThanOrEqual(context!.y + context!.height);
      }
      await page.screenshot({ path: info.outputPath(`${path.replaceAll("/", "_")}.png`), fullPage: false });
      if (/^\/teacher\/courses\/[^/]+$/.test(path)) {
        for (const child of ["chapters", "materials"]) {
          const href = `${path}/${child}`;
          await page.goto(href);
          measures.push(await checkPage(page, href));
          await page.screenshot({ path: info.outputPath(`${child}.png`), fullPage: false });
        }
      }
      if (/^\/teacher\/classes\/[^/]+$/.test(path)) {
        await page.goto(`${path}/analytics`);
        measures.push(await checkPage(page, `${path}/analytics`));
      }
    }
    await page.goto(entry);
    if ((page.viewportSize()?.width ?? 1440) < 960) {
      await page.getByRole("button", { name: "打开主导航" }).click();
      const navigation = page.getByRole("navigation", { name: "主导航", exact: true });
      await expect(navigation).toBeVisible();
      for (const link of await navigation.getByRole("link").all()) {
        const rect = await link.boundingBox();
        expect(rect!.height).toBeGreaterThanOrEqual(44);
        expect(rect!.x + rect!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      }
      await page.screenshot({ path: info.outputPath("navigation-expanded.png") });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "打开主导航" })).toBeFocused();
    }
    await writeFile(info.outputPath("readability.json"), JSON.stringify(measures, null, 2));
    console.log(JSON.stringify({ role, viewport: info.project.name, pages: measures.length }));
  });
}
