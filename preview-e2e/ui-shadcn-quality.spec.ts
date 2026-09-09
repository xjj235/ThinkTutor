import { expect, test, type Page, type Request, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const previewURL = "http://127.0.0.1:3102";
const themeKey = "thinktutor-theme";
type Theme = "light" | "dark";
type PreviewRole = "student" | "teacher" | "admin";
const roleEntries = { student: "/dashboard", teacher: "/teacher", admin: "/admin" };

test.use({ baseURL: previewURL, serviceWorkers: "block" });

interface RuntimeEvidence {
  pageErrors: string[];
  consoleErrors: { text: string; url: string }[];
  failedRequests: { method: string; url: string; error: string }[];
  httpErrors: { method: string; url: string; status: number; expected: boolean }[];
  blockedMutations: { method: string; url: string }[];
  injectedFaults: Set<Request>;
}

interface ThemePaintProbe {
  supported: boolean;
  changes: { time: number; theme: string | null }[];
  paints: { name: string; startTime: number; theme: string | null; themeAtPaint: string | null }[];
}

const runtimeEvidence = new WeakMap<Page, RuntimeEvidence>();

async function attachJSON(info: TestInfo, name: string, data: unknown) {
  const path = info.outputPath(`${name}.json`);
  await writeFile(path, JSON.stringify(data, null, 2));
  await info.attach(name, { path, contentType: "application/json" });
}

test.beforeEach(async ({ page, context }) => {
  const evidence: RuntimeEvidence = {
    pageErrors: [], consoleErrors: [], failedRequests: [], httpErrors: [],
    blockedMutations: [], injectedFaults: new Set<Request>(),
  };
  runtimeEvidence.set(page, evidence);
  page.on("pageerror", error => evidence.pageErrors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" || /hydration|hydrated|did not match/i.test(message.text())) {
      evidence.consoleErrors.push({ text: message.text(), url: message.location().url });
    }
  });
  page.on("requestfailed", request => evidence.failedRequests.push({
    method: request.method(), url: request.url(), error: request.failure()?.errorText ?? "unknown",
  }));
  page.on("response", response => {
    if (response.status() >= 400) evidence.httpErrors.push({
      method: response.request().method(), url: response.url(), status: response.status(),
      expected: response.status() === 503 && evidence.injectedFaults.has(response.request()),
    });
  });
  // Login is the only permitted write. Block accidental submissions before they reach the preview.
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const read = ["GET", "HEAD", "OPTIONS"].includes(request.method());
    const login = url.origin === previewURL && url.pathname === "/api/auth/login" && request.method() === "POST";
    if (read || login) return route.continue();
    evidence.blockedMutations.push({ method: request.method(), url: request.url() });
    await route.abort("blockedbyclient");
  });
});

test.afterEach(async ({ page }, info) => {
  const evidence = runtimeEvidence.get(page);
  if (!evidence) return;
  const injectedFaults = [...evidence.injectedFaults].map(request => ({
    method: request.method(), url: request.url(), status: 503,
  }));
  const consoleErrors = evidence.consoleErrors.map(error => ({
    ...error,
    expected: /Failed to load resource.*503/i.test(error.text)
      && injectedFaults.some(fault => fault.url === error.url),
  }));
  await attachJSON(info, "runtime-evidence", { previewURL, project: info.project.name, ...evidence, consoleErrors, injectedFaults });
  expect.soft(evidence.pageErrors, "Uncaught exceptions, including hydration failures").toEqual([]);
  expect.soft(consoleErrors.filter(error => !error.expected), "Unexpected browser console errors").toEqual([]);
  expect.soft(evidence.httpErrors.filter(error => !error.expected), "Unexpected HTTP failures").toEqual([]);
  expect.soft(evidence.failedRequests, "Unexpected network failures").toEqual([]);
  expect.soft(evidence.blockedMutations, "The audit must not submit learning or administration mutations").toEqual([]);
});

async function waitForMain(page: Page, allowSessionLoading = false) {
  await expect(page.getByRole("heading", { name: "正在加载页面", exact: true, includeHidden: true })).toHaveCount(0);
  if (!allowSessionLoading) await expect(page.locator('.workspace-state[data-variant="loading"]')).toHaveCount(0);
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator("main h1")).toBeVisible();
}

async function visit(page: Page, path: string) {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response?.status(), path).toBe(200);
  await expect(page).toHaveURL(new URL(path, previewURL).href);
  await waitForMain(page);
  if (path.startsWith("/session/")) await expect(page.locator("main.learning-workspace")).toBeVisible();
  if (path.startsWith("/report/")) await expect(page.locator("main.report-page .report-summary")).toBeVisible();
}

async function login(page: Page, role: PreviewRole) {
  await visit(page, `/login?email=${role}%40example.test`);
  await expect(page.getByLabel("邮箱", { exact: true })).toHaveValue(`${role}@example.test`);
  await expect(page.getByLabel("密码", { exact: true })).not.toHaveValue("");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(new URL(roleEntries[role], previewURL).href);
  await waitForMain(page);
  await expect(page.locator(".workspace-topbar")).toBeVisible();
}

async function discoverStudentDetail(page: Page, kind: "session" | "report") {
  const paths = kind === "report"
    ? ["/dashboard", "/history?phase=COMPLETED", "/history"]
    : ["/dashboard", "/history?phase=SOCRATIC", "/history?phase=DIAGNOSIS", "/history"];
  for (const path of paths) {
    await visit(page, path);
    const links = await page.locator("main a[href]").evaluateAll(elements => elements.map(element => element.getAttribute("href") ?? ""));
    const href = links.find(link => new RegExp(`^/${kind}/[^/?#]+$`).test(link) && !link.endsWith("/new"));
    if (href) return href;
  }
  throw new Error(`Readonly preview prerequisite: student@example.test needs an existing ${kind} link. No learning data was created.`);
}

async function assertTheme(page: Page, theme: Theme) {
  const toggle = page.locator("button.icon-button.theme-toggle");
  const label = theme === "light" ? "切换为深色" : "切换为浅色";
  await expect(toggle).toHaveCount(1);
  await expect(toggle).toHaveAccessibleName(label);
  await expect(toggle).toHaveAttribute("title", label);
  await expect(toggle.locator(theme === "light" ? "svg.lucide-moon" : "svg.lucide-sun")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  await expect(page.locator("html")).toHaveCSS("color-scheme", theme);
}

async function focusThemeByKeyboard(page: Page) {
  const toggle = page.locator("button.theme-toggle");
  await expect(toggle).toBeEnabled();
  for (let index = 0; index < 24; index += 1) {
    await page.keyboard.press("Tab");
    if (await toggle.evaluate(element => element === document.activeElement)) break;
  }
  await expect(toggle).toBeFocused();
  const focus = await toggle.evaluate(element => {
    const style = getComputedStyle(element);
    return { outline: style.outlineStyle, width: parseFloat(style.outlineWidth), shadow: style.boxShadow };
  });
  expect((focus.outline !== "none" && focus.width > 0) || focus.shadow !== "none", "Keyboard focus must be visible").toBe(true);
}

async function setTheme(page: Page, theme: Theme) {
  await expect(page.locator("html")).toHaveAttribute("data-theme", /^(light|dark)$/);
  if (await page.locator("html").getAttribute("data-theme") !== theme) {
    await focusThemeByKeyboard(page);
    await page.keyboard.press("Enter");
  }
  await assertTheme(page, theme);
}

async function measureStyles(page: Page) {
  return page.evaluate(() => {
    type Color = { r: number; g: number; b: number; a: number };
    const transparent: Color = { r: 0, g: 0, b: 0, a: 0 };
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas is required to resolve computed CSS colors.");
    const colors = new Map<string, Color>();
    const styles = new Map<Element, CSSStyleDeclaration>();
    const styleOf = (element: Element) => {
      let style = styles.get(element);
      if (!style) { style = getComputedStyle(element); styles.set(element, style); }
      return style;
    };
    const colorOf = (value: string): Color => {
      const cached = colors.get(value);
      if (cached) return cached;
      if (!CSS.supports("color", value)) throw new Error(`Unsupported computed color: ${value}`);
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data;
      const color = { r, g, b, a: alpha / 255 };
      colors.set(value, color);
      return color;
    };
    const composite = (front: Color, back: Color): Color => {
      const a = front.a + back.a * (1 - front.a);
      if (!a) return transparent;
      const channel = (key: "r" | "g" | "b") => (front[key] * front.a + back[key] * back.a * (1 - front.a)) / a;
      return { r: channel("r"), g: channel("g"), b: channel("b"), a };
    };
    // Compose from the text/control outward so ancestor opacity affects the whole painted group.
    const pixel = (element: Element | null, foreground = transparent, selfBackground = true): Color => {
      let result = foreground;
      for (let current = element; current; current = current.parentElement) {
        const style = styleOf(current);
        if (current !== element || selfBackground) result = composite(result, colorOf(style.backgroundColor));
        result = { ...result, a: result.a * Number(style.opacity) };
      }
      return composite(result, { r: 255, g: 255, b: 255, a: 1 });
    };
    const luminance = (color: Color) => [color.r, color.g, color.b].reduce((sum, channel, index) => {
      const value = channel / 255;
      return sum + (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index];
    }, 0);
    const contrast = (first: Color, second: Color) => {
      const a = luminance(first), b = luminance(second);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const visible = (element: Element) => element instanceof HTMLElement
      && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      && !element.closest('[hidden], [inert], [aria-hidden="true"], .sr-only')
      && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
    const disabled = (element: Element) => Boolean(element.closest(':disabled, [aria-disabled="true"]'));
    const identify = (element: Element) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}${[...element.classList].slice(0, 3).map(name => `.${name}`).join("")}`;
    const regionOf = (element: Element) => element.closest(".evidence-section") ? "evidence-section" : element.closest("main") ? "main" : "navigation";
    const backgroundIssue = (element: Element) => {
      // The photographic hero needs pixel sampling; never extend this exclusion to the evidence band.
      if (element.closest(".public-hero")) return "photographic-hero";
      for (let current: Element | null = element; current; current = current.parentElement) {
        const decoration = current === element && current.matches('select, input[type="checkbox"], input[type="radio"]');
        if (!decoration && styleOf(current).backgroundImage !== "none") return `background-image on ${identify(current)}`;
      }
      return null;
    };
    const excluded: { element: string; region: string; reason: string }[] = [];
    const textContrasts: {
      element: string; region: string; text: string; fontSize: number; fontWeight: string;
      color: string; foreground: Color; background: Color; ratio: number; required: number;
    }[] = [];
    const measureText = (element: Element, text: string, pseudo?: "::placeholder") => {
      if (!visible(element) || disabled(element)) return;
      const reason = backgroundIssue(element);
      if (reason) { excluded.push({ element: identify(element), region: regionOf(element), reason }); return; }
      const style = pseudo ? getComputedStyle(element, pseudo) : styleOf(element);
      const fontSize = parseFloat(style.fontSize);
      const color = colorOf(style.color);
      const foreground = pixel(element, pseudo ? { ...color, a: color.a * Number(style.opacity) } : color);
      const background = pixel(element);
      const large = fontSize >= 24 || (fontSize >= 18.667 && Number(style.fontWeight) >= 700);
      textContrasts.push({
        element: `${identify(element)}${pseudo ?? ""}`, region: regionOf(element), text: text.slice(0, 80),
        fontSize, fontWeight: style.fontWeight, color: style.color, foreground, background,
        ratio: contrast(foreground, background), required: large ? 3 : 4.5,
      });
    };
    const textElements = new Map<Element, string[]>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const element = walker.currentNode.parentElement;
      const text = walker.currentNode.textContent?.replace(/\s+/g, " ").trim();
      if (!element || !text || !element.closest("main, .site-header, .workspace-shell, .site-footer")) continue;
      if (element.closest("script, style, option, textarea, svg")) continue;
      const texts = textElements.get(element) ?? [];
      texts.push(text);
      textElements.set(element, texts);
    }
    for (const [element, texts] of textElements) measureText(element, texts.join(" "));
    const controls = [...document.querySelectorAll('main input:not([type="hidden"]), main textarea, main select')];
    for (const element of controls) {
      if (element.matches('input[type="checkbox"], input[type="radio"], input[type="range"], input[type="color"], input[type="file"]')) continue;
      if (element.matches(":placeholder-shown")) measureText(element, element.getAttribute("placeholder") ?? "", "::placeholder");
      else if ((element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value) measureText(element, "[control value]");
    }
    const controlBorders = controls.filter(element => visible(element) && !disabled(element)).flatMap(element => {
      const reason = backgroundIssue(element);
      if (reason) { excluded.push({ element: identify(element), region: regionOf(element), reason }); return []; }
      const style = styleOf(element);
      const interior = pixel(element), exterior = pixel(element.parentElement);
      return ["top", "right", "bottom", "left"].map(side => {
        const width = parseFloat(style.getPropertyValue(`border-${side}-width`));
        const borderStyle = style.getPropertyValue(`border-${side}-style`);
        const color = style.getPropertyValue(`border-${side}-color`);
        const border = pixel(element, colorOf(color), style.backgroundClip.includes("border-box"));
        return {
          element: identify(element), side, width, borderStyle, color, background: style.backgroundColor,
          border, interior, exterior, interiorRatio: contrast(border, interior),
          ratio: width > 0 && !["none", "hidden"].includes(borderStyle) ? contrast(border, exterior) : 0,
          required: 3,
        };
      });
    });
    // Opaque primary buttons can be measured directly even over the photographic hero.
    const heroPrimaryButtons = [...document.querySelectorAll(".public-hero .hero-actions .button:not(.button-secondary)")]
      .filter(element => visible(element) && !disabled(element)).map(element => {
        const style = styleOf(element), rect = element.getBoundingClientRect();
        const background = colorOf(style.backgroundColor);
        const foreground = composite(colorOf(style.color), background);
        let opacity = 1;
        for (let current: Element | null = element; current; current = current.parentElement) opacity *= Number(styleOf(current).opacity);
        return {
          element: identify(element), color: style.color, backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage, foreground, background, opacity,
          ratio: background.a === 1 && opacity === 1 && style.backgroundImage === "none" ? contrast(foreground, background) : null,
          required: 4.5, width: rect.width, height: rect.height, hovered: element.matches(":hover"),
        };
      });
    const selectors = ["main", ".site-header", ".brand", ".workspace-topbar", ".workspace-links", ".page-heading", ".stat-card", ".data-row", ".form-section", ".learning-context", ".learning-record", ".report-summary", ".evidence-section", ".workspace-state", ".theme-toggle", "main input", "main textarea", "main select"];
    const boxes = selectors.flatMap(selector => {
      const element = document.querySelector(selector);
      if (!element || !visible(element)) return [];
      const style = styleOf(element), rect = element.getBoundingClientRect();
      return [{
        selector, x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        font: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight,
        padding: style.padding, gap: style.gap, radius: style.borderRadius, color: style.color,
        background: style.backgroundColor, border: style.borderColor, opacity: style.opacity,
      }];
    });
    const brand = document.querySelector(".brand")?.getBoundingClientRect();
    const toggle = document.querySelector(".theme-toggle")?.getBoundingClientRect();
    const root = styleOf(document.documentElement);
    return {
      url: location.href, theme: document.documentElement.dataset.theme, colorScheme: root.colorScheme,
      viewport: { width: innerWidth, height: innerHeight },
      documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
      horizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > innerWidth + 1,
      brandOverlap: Boolean(brand && toggle && brand.left < toggle.right && brand.right > toggle.left && brand.top < toggle.bottom && brand.bottom > toggle.top),
      tokens: Object.fromEntries(["--background", "--foreground", "--card", "--muted", "--muted-foreground", "--border", "--input", "--ring", "--brand", "--text-body", "--radius-control"].map(key => [key, root.getPropertyValue(key).trim()])),
      boxes, textContrasts, controlBorders, heroPrimaryButtons, excluded,
      overflowingElements: [...document.querySelectorAll("main *, .site-header *, .workspace-shell *")].filter(visible).flatMap(element => {
        const rect = element.getBoundingClientRect();
        return rect.left < -1 || rect.right > innerWidth + 1 ? [{ element: identify(element), left: rect.left, right: rect.right }] : [];
      }).slice(0, 40),
    };
  });
}

async function capture(page: Page, info: TestInfo, name: string, allowSessionLoading = false) {
  await waitForMain(page, allowSessionLoading);
  await page.evaluate(async () => {
    await document.fonts.ready;
    const finiteAnimations = document.getAnimations().filter(animation =>
      animation.playState === "running" && Number.isFinite(Number(animation.effect?.getComputedTiming().endTime ?? Infinity)));
    await Promise.all(finiteAnimations.map(animation => animation.finished.catch(() => undefined)));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const measurements = await measureStyles(page);
  await attachJSON(info, `${name}-computed-styles`, { project: info.project.name, ...measurements });
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await info.attach(name, { path, contentType: "image/png" });
  return measurements;
}

function assertQuality(measurements: Awaited<ReturnType<typeof measureStyles>>) {
  expect.soft(measurements.horizontalOverflow, `${measurements.url}: horizontal overflow`).toBe(false);
  expect.soft(measurements.brandOverlap, "Theme button must not overlap the brand").toBe(false);
  expect.soft(measurements.textContrasts.length, "Visible text must actually be measured").toBeGreaterThan(0);
  expect.soft(measurements.excluded.filter(item => item.reason !== "photographic-hero"), "Unmeasured solid-surface text or controls").toEqual([]);
  expect.soft(measurements.textContrasts.filter(item => item.ratio < item.required), "Text contrast: 14-18px requires 4.5:1 even when bold").toEqual([]);
  expect.soft(measurements.controlBorders.filter(item => item.ratio < item.required), "Enabled input boundaries require 3:1 against the adjacent surface").toEqual([]);
}

for (const surface of ["public", "student"] as const) {
  test(`${surface}: keyboard theme switch persists and system dark does not change the default`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: "dark" });
    if (surface === "student") await login(page, "student");
    else await visit(page, "/");
    await assertTheme(page, "light");
    expect(await page.evaluate(key => localStorage.getItem(key), themeKey)).toBeNull();
    await focusThemeByKeyboard(page);
    await page.keyboard.press("Enter");
    await assertTheme(page, "dark");
    expect(await page.evaluate(key => localStorage.getItem(key), themeKey)).toBe("dark");
    await page.emulateMedia({ colorScheme: "light" });
    await assertTheme(page, "dark");
    await page.reload({ waitUntil: "domcontentloaded" });
    await assertTheme(page, "dark");
    await capture(page, info, "keyboard-dark-persisted");
    await focusThemeByKeyboard(page);
    await page.keyboard.press("Space");
    await assertTheme(page, "light");
    expect(await page.evaluate(key => localStorage.getItem(key), themeKey)).toBe("light");
    await page.emulateMedia({ colorScheme: "dark" });
    await assertTheme(page, "light");
    await page.reload({ waitUntil: "domcontentloaded" });
    await assertTheme(page, "light");
    await capture(page, info, "keyboard-light-persisted");
  });
}

for (const failure of ["get", "set", "both"] as const) {
  test(`theme storage ${failure} throws: switching still works in both directions`, async ({ page }, info) => {
    await page.addInitScript(({ key, failure }) => {
      const originalGet = Storage.prototype.getItem;
      const originalSet = Storage.prototype.setItem;
      const probe = { reads: 0, writes: 0, readThrows: 0, writeThrows: 0 };
      Object.defineProperty(window, "__themeStorageProbe", { value: probe });
      Storage.prototype.getItem = function (name: string) {
        if (name === key) {
          probe.reads += 1;
          if (failure !== "set") {
            probe.readThrows += 1;
            throw new DOMException("Injected storage read failure", "SecurityError");
          }
        }
        return originalGet.call(this, name);
      };
      Storage.prototype.setItem = function (name: string, value: string) {
        if (name === key) {
          probe.writes += 1;
          if (failure !== "get") {
            probe.writeThrows += 1;
            throw new DOMException("Injected storage write failure", "SecurityError");
          }
        }
        originalSet.call(this, name, value);
      };
    }, { key: themeKey, failure });
    await page.emulateMedia({ colorScheme: "dark" });
    await visit(page, "/");
    await assertTheme(page, "light");
    await focusThemeByKeyboard(page);
    await page.keyboard.press("Enter");
    await assertTheme(page, "dark");
    await capture(page, info, "storage-unavailable-dark");
    await page.keyboard.press("Space");
    await assertTheme(page, "light");
    await page.reload({ waitUntil: "domcontentloaded" });
    await assertTheme(page, "light");
    await focusThemeByKeyboard(page);
    await page.keyboard.press("Enter");
    await assertTheme(page, "dark");
    await page.keyboard.press("Space");
    await assertTheme(page, "light");
    await capture(page, info, "storage-unavailable-light");
    const probe = await page.evaluate(() => (window as Window & {
      __themeStorageProbe?: { reads: number; writes: number; readThrows: number; writeThrows: number };
    }).__themeStorageProbe);
    if (!probe) throw new Error("Storage failure probe was not installed before hydration");
    await attachJSON(info, "storage-faults", { failure, ...probe });
    expect(probe.reads).toBeGreaterThan(0);
    expect(probe.writes).toBeGreaterThanOrEqual(2);
    expect(probe.readThrows > 0).toBe(failure !== "set");
    expect(probe.writeThrows > 0).toBe(failure !== "get");
  });
}

const surfaces: { name: string; role?: PreviewRole; path?: string; detail?: "session" | "report" }[] = [
  { name: "public-home", path: "/" },
  { name: "student-dashboard", role: "student", path: "/dashboard" },
  { name: "student-form", role: "student", path: "/learn/new" },
  { name: "student-profile", role: "student", path: "/profile" },
  { name: "student-session", role: "student", detail: "session" },
  { name: "student-report", role: "student", detail: "report" },
  { name: "teacher-dashboard", role: "teacher", path: "/teacher" },
  { name: "admin-dashboard", role: "admin", path: "/admin" },
];

for (const surface of surfaces) {
  test(`${surface.name}: light and dark screenshots, contrast, geometry and runtime`, async ({ page }, info) => {
    test.setTimeout(120_000);
    if (surface.role) await login(page, surface.role);
    const path = surface.detail ? await discoverStudentDetail(page, surface.detail) : surface.path;
    if (!path) throw new Error(`Missing route for ${surface.name}`);
    await visit(page, path);
    if (surface.name === "public-home") {
      await expect(page.locator(".public-hero-image")).toBeVisible();
      await expect.poll(() => page.locator(".public-hero-image").evaluate(element => element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0)).toBe(true);
    }
    for (const theme of ["light", "dark"] as const) {
      await setTheme(page, theme);
      const measurements = await capture(page, info, `${surface.name}-${theme}`);
      assertQuality(measurements);
      if (surface.name === "public-home") {
        await expect(page.locator(".evidence-section")).toBeVisible();
        expect.soft(measurements.textContrasts.filter(item => item.region === "evidence-section").length, "Home evidence text is mandatory contrast coverage").toBeGreaterThan(0);
      }
      if (["student-form", "student-profile"].includes(surface.name)) {
        expect.soft(measurements.controlBorders.length, "Form controls must actually be measured").toBeGreaterThan(0);
      }
    }
  });
}

test("session GET delayed at least 1500ms exposes loading without writing learning data", async ({ page }, info) => {
  test.setTimeout(120_000);
  await login(page, "student");
  const path = await discoverStudentDetail(page, "session");
  const apiURL = new URL(`/api/sessions/${path.split("/").pop()}`, previewURL).href;
  await setTheme(page, "dark");
  let releaseCapture: () => void = () => {};
  const captured = new Promise<void>(resolve => { releaseCapture = resolve; });
  const reads: { method: string; elapsedMs: number }[] = [];
  await page.route(apiURL, async route => {
    if (route.request().method() !== "GET") return route.fallback();
    const started = Date.now();
    // Keep the 1500ms minimum and hold until capture completes, including on slow preview builds.
    await Promise.all([new Promise<void>(resolve => setTimeout(resolve, 1500)), captured]);
    reads.push({ method: route.request().method(), elapsedMs: Date.now() - started });
    await route.fallback();
  });
  try {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await waitForMain(page, true);
    await expect(page.getByRole("heading", { name: "正在读取学习会话", exact: true })).toBeVisible();
    await expect(page.locator('.workspace-state[data-variant="loading"] .skeleton-lines')).toBeVisible();
    assertQuality(await capture(page, info, "session-get-loading-dark", true));
  } finally {
    releaseCapture();
  }
  await expect(page.locator("main.learning-workspace")).toBeVisible();
  await expect(page.locator('.workspace-state[data-variant="loading"]')).toHaveCount(0);
  expect(reads.length).toBeGreaterThan(0);
  expect(reads.every(read => read.method === "GET" && read.elapsedMs >= 1500)).toBe(true);
  await attachJSON(info, "session-delay", { apiURL, minimumDelayMs: 1500, reads });
  assertQuality(await capture(page, info, "session-get-loaded-dark"));
});

test("session GET 503 shows an error and reload recovers with GET only", async ({ page }, info) => {
  test.setTimeout(120_000);
  await login(page, "student");
  const path = await discoverStudentDetail(page, "session");
  const apiURL = new URL(`/api/sessions/${path.split("/").pop()}`, previewURL).href;
  await setTheme(page, "dark");
  const evidence = runtimeEvidence.get(page);
  if (!evidence) throw new Error("Runtime evidence was not initialized");
  let fail = true;
  let recoveredReads = 0;
  await page.route(apiURL, async route => {
    if (route.request().method() !== "GET") return route.fallback();
    if (!fail) { recoveredReads += 1; return route.fallback(); }
    evidence.injectedFaults.add(route.request());
    await route.fulfill({
      status: 503, contentType: "application/json",
      body: JSON.stringify({
        error: { code: "PREVIEW_UI_GET_FAULT", message: "读取暂时不可用，请重试。", retryable: true },
        requestId: "preview-ui-shadcn-readonly",
      }),
    });
  });
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await waitForMain(page);
  await expect(page.locator("main").getByRole("alert")).toContainText("读取暂时不可用，请重试。");
  await expect(page.getByRole("heading", { name: "无法读取学习会话", exact: true })).toBeVisible();
  const retry = page.getByRole("button", { name: "重新加载", exact: true });
  await expect(retry).toBeEnabled();
  assertQuality(await capture(page, info, "session-get-error-dark"));
  fail = false;
  await retry.click();
  await expect(page.locator("main.learning-workspace")).toBeVisible();
  await expect(page.locator('.workspace-state[data-variant="error"]')).toHaveCount(0);
  expect(evidence.injectedFaults.size).toBeGreaterThan(0);
  expect(recoveredReads).toBeGreaterThan(0);
  await attachJSON(info, "session-error-recovery", { apiURL, injectedStatus: 503, injectedReads: evidence.injectedFaults.size, recoveredReads });
  assertQuality(await capture(page, info, "session-get-recovered-dark"));
});

test("focused: stored dark theme is applied before the first paint and after reload", async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(key => {
    window.localStorage.setItem(key, "dark");
    const probe: ThemePaintProbe = {
      supported: PerformanceObserver.supportedEntryTypes.includes("paint"), changes: [], paints: [],
    };
    Object.defineProperty(window, "__themePaintProbe", { value: probe });
    const recordTheme = () => {
      const theme = document.documentElement?.dataset.theme ?? null;
      if (!probe.changes.length || probe.changes[probe.changes.length - 1].theme !== theme) {
        probe.changes.push({ time: performance.now(), theme });
      }
    };
    recordTheme();
    new MutationObserver(recordTheme).observe(document, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["data-theme"],
    });
    if (probe.supported) {
      new PerformanceObserver(entries => {
        for (const entry of entries.getEntries()) {
          const beforePaint = probe.changes.filter(change => change.time <= entry.startTime).at(-1);
          probe.paints.push({
            name: entry.name, startTime: entry.startTime,
            theme: document.documentElement?.dataset.theme ?? null,
            themeAtPaint: beforePaint?.theme ?? null,
          });
        }
      }).observe({ type: "paint", buffered: true });
    }
  }, themeKey);
  const readProbe = () => page.evaluate(() => (window as Window & { __themePaintProbe?: ThemePaintProbe }).__themePaintProbe);
  for (const navigation of ["initial", "reload"] as const) {
    if (navigation === "initial") await visit(page, "/");
    else {
      const response = await page.reload({ waitUntil: "domcontentloaded" });
      expect(response?.status()).toBe(200);
      await waitForMain(page);
    }
    expect((await readProbe())?.supported, "Paint timing must be available; missing samples are not a pass").toBe(true);
    await expect.poll(async () => {
      const probe = await readProbe();
      return ["first-paint", "first-contentful-paint"].every(name => probe?.paints.some(paint => paint.name === name));
    }).toBe(true);
    const probe = await readProbe();
    if (!probe) throw new Error("Theme paint observer was not installed before page scripts");
    await attachJSON(info, `stored-dark-${navigation}-paint`, probe);
    expect.soft(probe.paints.filter(paint => paint.theme !== "dark" || paint.themeAtPaint !== "dark"), "Saved dark must already apply at each initial paint, before hydration can repair it").toEqual([]);
    await assertTheme(page, "dark");
    await capture(page, info, `stored-dark-${navigation}`);
  }
  const evidence = runtimeEvidence.get(page);
  if (!evidence) throw new Error("Runtime evidence was not initialized");
  const hydrationErrors = [...evidence.pageErrors, ...evidence.consoleErrors.map(error => error.text)]
    .filter(message => /hydrat|did not match|Minified React error #(418|423|425)/i.test(message));
  await attachJSON(info, "stored-dark-hydration", { hydrationErrors });
  expect(hydrationErrors, "Stored-theme initialization must not cause hydration errors").toEqual([]);
});

test("focused: reduced motion removes skeleton and loader animations during a delayed session GET", async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await login(page, "student");
  const path = await discoverStudentDetail(page, "session");
  const apiURL = new URL(`/api/sessions/${path.split("/").pop()}`, previewURL).href;
  await setTheme(page, "dark");
  let releaseCapture: () => void = () => {};
  const captured = new Promise<void>(resolve => { releaseCapture = resolve; });
  let reads = 0;
  await page.route(apiURL, async route => {
    if (route.request().method() !== "GET") return route.fallback();
    reads += 1;
    await Promise.all([new Promise<void>(resolve => setTimeout(resolve, 1500)), captured]);
    await route.fallback();
  });
  try {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await waitForMain(page, true);
    const loading = page.locator('main .workspace-state[data-variant="loading"]');
    await expect(loading.getByRole("heading", { name: "正在读取学习会话", exact: true })).toBeVisible();
    await expect(loading.locator(".state-symbol svg")).toBeVisible();
    await expect(loading.locator(".skeleton-line").first()).toBeVisible();
    const motionTargets = loading.locator(".state-symbol, .state-symbol svg, .skeleton-lines, .skeleton-line");
    const readMotion = () => motionTargets.evaluateAll(elements => elements.flatMap(element =>
      [null, "::before", "::after"].flatMap(pseudo => {
        const style = getComputedStyle(element, pseudo);
        if (pseudo && ["none", "normal", ""].includes(style.content)) return [];
        return [{
          element: `${element.tagName.toLowerCase()}.${[...element.classList].join(".")}${pseudo ?? ""}`,
          animationName: style.animationName, animationDuration: style.animationDuration,
          animationIterationCount: style.animationIterationCount, transform: style.transform,
        }];
      })));
    const normal = await readMotion();
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    const reduced = await readMotion();
    const activeAnimations = await loading.evaluate(element => element.getAnimations({ subtree: true })
      .filter(animation => animation.playState === "running" || animation.pending)
      .map(animation => ({ playState: animation.playState, timing: animation.effect?.getComputedTiming() })));
    await attachJSON(info, "reduced-motion-loading", { apiURL, normal, reduced, activeAnimations });
    expect.soft(reduced.length, "Skeleton and loader styles must actually be sampled").toBeGreaterThan(0);
    expect.soft(reduced.filter(item => item.animationName.split(",").some(name => name.trim() !== "none")), "Reduced motion requires animation-name: none, not a shortened infinite animation").toEqual([]);
    expect.soft(activeAnimations, "No loader or skeleton animation should remain active").toEqual([]);
    await capture(page, info, "reduced-motion-session-loading-dark", true);
  } finally {
    releaseCapture();
  }
  await waitForMain(page);
  await expect(page.locator("main.learning-workspace")).toBeVisible();
  expect(reads).toBeGreaterThan(0);
});

test("focused: dark home primary hover keeps contrast and size, and data row focus stays inset", async ({ page }, info) => {
  test.setTimeout(120_000);
  await visit(page, "/");
  await setTheme(page, "dark");
  const primary = page.locator(".public-hero .hero-actions .button:not(.button-secondary)");
  await expect(primary).toHaveCount(1);
  await expect(primary).toBeVisible();
  await primary.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  const normal = await capture(page, info, "dark-home-primary-normal");
  await primary.hover();
  await expect.poll(() => primary.evaluate(element => element.matches(":hover"))).toBe(true);
  const hovered = await capture(page, info, "dark-home-primary-hover");
  expect(normal.heroPrimaryButtons).toHaveLength(1);
  expect(hovered.heroPrimaryButtons).toHaveLength(1);
  const before = normal.heroPrimaryButtons[0], after = hovered.heroPrimaryButtons[0];
  await attachJSON(info, "dark-home-primary-hover-comparison", { before, after });
  expect.soft(before.hovered, "Baseline must be captured without hover").toBe(false);
  expect.soft(after.hovered).toBe(true);
  expect.soft(after.ratio, "Opaque primary button colors must be measured despite the hero exclusion").not.toBeNull();
  expect.soft(after.ratio ?? 0, "Dark home primary hover text contrast").toBeGreaterThanOrEqual(4.5);
  expect.soft(after.width, "Hover must preserve button width").toBe(before.width);
  expect.soft(after.height, "Hover must preserve button height").toBe(before.height);

  await login(page, "student");
  await assertTheme(page, "dark");
  const row = page.locator("main a.data-row").first();
  await expect(row).toBeVisible();
  await row.scrollIntoViewIfNeeded();
  for (let index = 0; index < 64; index += 1) {
    await page.keyboard.press("Tab");
    if (await row.evaluate(element => element === document.activeElement)) break;
  }
  await expect(row).toBeFocused();
  const focus = await row.evaluate(element => {
    const style = getComputedStyle(element);
    return {
      focusVisible: element.matches(":focus-visible"), outlineStyle: style.outlineStyle,
      outlineWidth: parseFloat(style.outlineWidth), outlineOffset: parseFloat(style.outlineOffset),
      outlineColor: style.outlineColor, boxShadow: style.boxShadow,
    };
  });
  await attachJSON(info, "data-row-keyboard-focus", focus);
  const insetOutline = !["none", "hidden"].includes(focus.outlineStyle) && focus.outlineWidth > 0 && focus.outlineOffset < 0;
  expect.soft(focus.focusVisible, "Data row must expose keyboard focus").toBe(true);
  expect.soft(insetOutline || /\binset\b/.test(focus.boxShadow), "The focus ring must use a negative outline offset or an inset shadow").toBe(true);
  await capture(page, info, "data-row-keyboard-focus-dark");
  await expect(row).toBeFocused();
});
