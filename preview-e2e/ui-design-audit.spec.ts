import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

async function measure(page: Page) {
  await expect(page.locator('.workspace-state[data-variant="loading"]')).toBeHidden();
  await expect(page.locator("main")).toHaveCount(1);
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const tokens = Object.fromEntries(["--canvas", "--paper", "--ink", "--ink-soft", "--ink-faint", "--line-strong", "--teal", "--text-body", "--text-reading", "--motion-fast", "--radius-control"].map(key => [key, root.getPropertyValue(key).trim()]));
    const selectors = [".page-shell", ".page-heading", ".workspace-topbar", ".workspace-links", ".stat-card", ".data-row", ".form-section", "input:not([type=hidden])", ".button", ".async-feedback", ".learning-entry .safe-markdown"];
    const boxes = selectors.flatMap(selector => {
      const element = document.querySelector(selector);
      if (!element) return [];
      const css = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return [{ selector, x: rect.x, y: rect.y, width: rect.width, height: rect.height, font: css.fontFamily, fontSize: css.fontSize, lineHeight: css.lineHeight, padding: css.padding, gap: css.gap, radius: css.borderRadius, transition: css.transitionDuration, color: css.color, background: css.backgroundColor, border: css.borderColor }];
    });
    // Composite solid ancestor backgrounds; image-backed text is explicitly excluded.
    const rgba = (value: string) => value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
    const luminance = (color: number[]) => color.slice(0, 3).map(v => { const n = v / 255; return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const contrasts = Array.from(document.querySelectorAll("main p, main label, main small, main h1, main h2, main .badge, main .button, .workspace-link")).flatMap(element => {
      const css = getComputedStyle(element);
      if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || element.closest(".public-hero") || element.matches(":disabled")) return [];
      const ancestors: Element[] = [];
      let current: Element | null = element;
      while (current) { ancestors.unshift(current); current = current.parentElement; }
      let bg = [255, 255, 255];
      for (const ancestor of ancestors) {
        const c = rgba(getComputedStyle(ancestor).backgroundColor);
        bg = bg.map((v, i) => c[i] * (c[3] ?? 1) + v * (1 - (c[3] ?? 1)));
      }
      const fg = rgba(css.color);
      if (fg.length < 3 || !css.color.startsWith("rgb")) return [];
      const a = luminance(fg), b = luminance(bg);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const large = parseFloat(css.fontSize) >= 24 || (parseFloat(css.fontSize) >= 18.67 && Number(css.fontWeight) >= 700);
      return [{ tag: element.tagName, text: element.textContent?.trim().slice(0, 32), ratio, required: large ? 3 : 4.5 }];
    });
    const controlBorders = Array.from(document.querySelectorAll("main input:not([type=hidden]), main textarea, main select")).flatMap(element => {
      if (element.matches(":disabled") || !element.checkVisibility()) return [];
      const style = getComputedStyle(element);
      const a = luminance(rgba(style.borderTopColor)), b = luminance(rgba(style.backgroundColor));
      return [{ id: element.id, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }];
    });
    return { tokens, boxes, contrasts, controlBorders, overflow: document.documentElement.scrollWidth > innerWidth, colorScheme: root.colorScheme };
  });
}

test("key surfaces, focus, dark preference and reduced motion", async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", e => { if (e.type() === "error") errors.push(e.text()); });
  await page.goto("/login?email=student%40example.test");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/dashboard$/);
  const results = [];
  for (const path of ["/dashboard", "/history", "/learn/new", "/assignments?status=COMPLETED"]) {
    await page.goto(path);
    results.push({ path, ...await measure(page) });
  }
  expect(results.flatMap(result => result.contrasts.filter(item => item.ratio < item.required))).toEqual([]);
  expect(results.flatMap(result => result.controlBorders.filter(item => item.ratio < 3))).toEqual([]);
  await page.goto("/dashboard");
  await measure(page);
  const alignment = await page.evaluate(() => ({
    heading: document.querySelector(".list-heading>span")!.checkVisibility() ? document.querySelector(".list-heading>span")!.getBoundingClientRect().x : null,
    content: document.querySelector(".data-row-detail strong")!.getBoundingClientRect().x,
    header: document.querySelector(".workspace-topbar")!.getBoundingClientRect().x,
    main: document.querySelector("main")!.getBoundingClientRect().x,
  }));
  if (alignment.heading !== null) expect(Math.abs(alignment.heading - alignment.content)).toBeLessThan(2);
  expect(Math.abs(alignment.header - alignment.main)).toBeLessThan(2);
  const button = page.locator("main .button").first();
  await button.hover();
  await page.screenshot({ path: info.outputPath("hover.png"), caret: "initial" });
  const rect = await button.boundingBox();
  await page.mouse.down();
  await page.screenshot({ path: info.outputPath("active.png"), caret: "initial" });
  const activeRect = await button.boundingBox();
  expect(activeRect).toEqual(rect);
  await page.mouse.move(0, 0);
  await page.mouse.up();
  await page.goto("/learn/new");
  const input = page.locator("#topic");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument");
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: "main h1" });
  const fonts = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
  await input.focus();
  await page.keyboard.press("Tab");
  const focus = await page.locator(":focus").evaluate(el => ({ outline: getComputedStyle(el).outlineStyle, width: getComputedStyle(el).outlineWidth }));
  expect(focus.outline).not.toBe("none");
  await page.screenshot({ path: info.outputPath("form-focus.png"), caret: "initial" });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/dashboard");
  const reduced = await page.locator("main .button").first().evaluate(el => ({ transform: getComputedStyle(el).transform, duration: getComputedStyle(el).transitionDuration }));
  expect(reduced.duration.split(",").every(duration => parseFloat(duration) === 0)).toBe(true);
  await page.screenshot({ path: info.outputPath("system-dark-preference.png"), caret: "initial" });
  expect(await page.locator("html").evaluate(el => getComputedStyle(el).colorScheme)).toBe("light");
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/learn/new");
  expect((await measure(page)).overflow).toBe(false);
  await page.screenshot({ path: info.outputPath("tablet-form.png"), fullPage: true, caret: "initial" });
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  expect((await measure(page)).overflow).toBe(false);
  await page.screenshot({ path: info.outputPath("zoom-200.png"), fullPage: true, caret: "initial" });
  await writeFile(info.outputPath("audit.json"), JSON.stringify({ results, alignment, fonts, focus, reduced, runtimeErrors: errors }, null, 2));
  expect(errors).toEqual([]);
});

test("loading and error feedback without writing preview data", async ({ page }, info) => {
  await page.goto("/login?email=teacher%40example.test");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/teacher$/);
  await page.goto("/teacher/courses/new");
  await page.getByLabel("课程名称", { exact: true }).fill("界面状态验证（不保存）");
  let release: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/courses", async route => {
    await pending;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "服务暂不可用，请稍后重试。" } }) });
  });
  await page.getByRole("button", { name: "创建课程", exact: true }).click();
  await expect(page.getByRole("button", { name: "创建中…", exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath("loading-disabled.png"), fullPage: true, caret: "initial" });
  release?.();
  const feedback = page.locator("main").getByRole("alert");
  await expect(feedback).toBeVisible();
  await expect(feedback.locator(".feedback-icon")).toBeVisible();
  expect(await feedback.evaluate(el => getComputedStyle(el).fontSize)).toBe("16px");
  await expect(page.getByRole("button", { name: "创建课程", exact: true })).toBeEnabled();
  await expect(page.getByLabel("课程名称", { exact: true })).toHaveValue("界面状态验证（不保存）");
  await page.screenshot({ path: info.outputPath("error.png"), fullPage: true, caret: "initial" });
  await writeFile(info.outputPath("error-state.json"), JSON.stringify({ faultInjection: "intercepted POST /api/courses -> 503, no database write", ...await measure(page) }, null, 2));
});

test("native dangerous-change confirmation cancels without a mutation", async ({ page }, info) => {
  await page.goto("/login?email=admin%40example.test");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/admin$/);
  await page.goto("/admin/users");
  const dialogs: string[] = [];
  const mutations: string[] = [];
  page.on("request", request => { if (request.method() === "PATCH") mutations.push(request.url()); });
  page.on("dialog", async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  const select = page.locator('select[aria-label$="的状态"]:enabled').first();
  const original = await select.inputValue();
  await select.selectOption("DISABLED");
  await expect(select).toHaveValue(original);
  expect(dialogs).toHaveLength(1);
  expect(mutations).toHaveLength(0);
  await page.screenshot({ path: info.outputPath("native-confirm-cancelled.png"), caret: "initial" });
  await writeFile(info.outputPath("native-dialog.json"), JSON.stringify({ dialogs, mutations, original, note: "Browser-native dialog; screenshot records page after cancel, not dialog chrome." }, null, 2));
});
