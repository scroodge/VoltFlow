#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { DEMO_EMAIL, DEMO_PASSWORD, DEMO_CAR_ID, charges } from "./fixtures/telegram-demo.mjs";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "docs/marketing/telegram-launch/screenshots/current");
const origin = "http://127.0.0.1:3037";
mkdirSync(output, { recursive: true });
const seedOutput = execFileSync(process.execPath, [resolve(root, "scripts/telegram-demo-seed.mjs")], {
  cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
});
JSON.parse(seedOutput.trim().split("\n").at(-1)); // Confirm the seed completed its final step.
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  locale: "ru-BY", timezoneId: "Europe/Minsk", colorScheme: "dark" });
const report = { capturedAt: new Date().toISOString(), viewport: "390×844 DPR 2", screens: [],
  externalRequests: [], failedLocal: [], browserErrors: [], browserWarnings: [], mockedLocal: ["/api/bydmate/latest-release"], complete: false };
await context.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (["127.0.0.1", "localhost"].includes(url.hostname)) {
    if (!["3037", "55321"].includes(url.port)) {
      report.failedLocal.push(`Unexpected loopback port ${url.port}`); return route.abort();
    }
    // Release discovery would call GitHub server-side; it is outside the demo.
    if (url.pathname === "/api/bydmate/latest-release")
      return route.fulfill({ status: 200, contentType: "application/json", body: "null" });
    return route.continue();
  }
  report.externalRequests.push({ origin: url.origin, path: url.pathname });
  if (url.hostname === "va.vercel-scripts.com")
    return route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
  return route.abort();
});
let page = await context.newPage();
page.setDefaultTimeout(45000);
function bindPage(currentPage) {
currentPage.on("pageerror", (error) => report.browserErrors.push(`${new URL(currentPage.url()).pathname}: ${error.stack || error.message}`));
currentPage.on("console", (message) => {
  if (message.type() !== "error") return;
  const text = message.text();
  if (text.includes("'upgrade-insecure-requests' is ignored when delivered in a report-only policy"))
    report.browserWarnings.push(text);
  else report.browserErrors.push(text);
});
currentPage.on("response", (response) => {
  const url = new URL(response.url());
  if (["127.0.0.1", "localhost"].includes(url.hostname) && response.status() >= 400)
    report.failedLocal.push(`${response.status()} ${url.pathname}`);
});
}
bindPage(page);
async function visit(path, text) {
  const target = new URL(path, origin);
  const exactLink = page.locator(`a[href="${path}"]`).first();
  const baseLink = page.locator(`a[href="${target.pathname}"]`).first();
  if (await exactLink.count()) {
    await exactLink.click();
    await page.waitForURL((url) => url.pathname === target.pathname);
  } else if (await baseLink.count()) {
    await baseLink.click();
    await page.waitForURL((url) => url.pathname === target.pathname);
  } else if (new URL(page.url()).pathname !== target.pathname) {
    await page.goto(target.href, { waitUntil: "domcontentloaded", timeout: 90000 });
  }
  if (target.pathname === "/history") {
    const tab = target.searchParams.get("tab") ?? "charging";
    await page.getByRole("button", { name: { charging: "Зарядка", trips: "Поездки", analytics: "Аналитика" }[tab], exact: true }).click();
    if (tab === "analytics") await page.getByRole("button", { name: "Месяц", exact: true }).click();
  }
  if (target.pathname === "/vehicle") {
    await page.getByRole("button", { name: target.searchParams.get("tab") === "service" ? "Сервис" : "Live", exact: true }).click();
  }
  if (text) await page.getByText(new RegExp(text, "i")).first().waitFor({ timeout: 45000 });
  await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(2200);
  if (new URL(page.url()).pathname === "/login") throw new Error(`Lost session on ${path}`);
}
async function settleVisible() {
  await page.waitForFunction(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0 && getComputedStyle(el).visibility !== "hidden";
    };
    return ![...document.querySelectorAll('[data-slot="skeleton"], [aria-busy="true"]')].some(visible) &&
      ![...document.querySelectorAll("p")].some((el) => visible(el) && /Формируем сводку|Сопоставляем GPS|Анализ повторных маршрутов/.test(el.innerText));
  }, undefined, { timeout: 60000 });
  await page.waitForTimeout(800);
}
async function capture(id, feature) {
  await settleVisible();
  await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(600);
  // Add the screenshot label after hydration, so it cannot alter React's SSR tree.
  await page.evaluate(() => {
    document.querySelectorAll("nextjs-portal").forEach((portal) => { portal.style.display = "none"; });
    if (document.getElementById("telegram-demo-label")) return;
    const label = document.createElement("div"); label.id = "telegram-demo-label";
    label.textContent = "Демонстрационные данные · @voltflowfaq";
    Object.assign(label.style, { position: "fixed", left: "0", right: "0", top: "0", zIndex: "2147483647",
      textAlign: "center", background: "#123528", color: "#a8ffd0", font: "11px system-ui", padding: "3px", pointerEvents: "none" });
    document.body.appendChild(label);
  });
  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  if (/Application error|Internal Server Error|Что-то пошло не так/.test(body)) throw new Error(`Error page: ${id}`);
  if (body.length < 250) throw new Error(`Unready or empty page: ${id}`);
  const filename = `${id}.png`;
  await page.screenshot({ path: resolve(output, filename), animations: "disabled", fullPage: true });
  const panels = [];
  const scroller = await page.evaluateHandle(() => [...document.querySelectorAll("*")]
    .filter((el) => el.clientHeight > 400 && el.scrollHeight > el.clientHeight + 100 &&
      /auto|scroll/.test(getComputedStyle(el).overflowY))
    .sort((a, b) => b.clientWidth - a.clientWidth)[0] ?? null);
  if (await scroller.evaluate((el) => Boolean(el))) {
    const dimensions = await scroller.evaluate((el) => ({ height: el.clientHeight, total: el.scrollHeight }));
    for (let offset = dimensions.height - 120, panel = 2; offset < dimensions.total; offset += dimensions.height - 120, panel++) {
      await scroller.evaluate((el, y) => { el.scrollTop = y; }, offset);
      await settleVisible();
      const panelFile = `${id}-panel-${String(panel).padStart(2, "0")}.png`;
      await page.screenshot({ path: resolve(output, panelFile), animations: "disabled" });
      panels.push(panelFile);
      if (offset + dimensions.height >= dimensions.total) break;
    }
    await scroller.evaluate((el) => { el.scrollTop = 0; });
  }
  await scroller.dispose();
  report.screens.push({ id, feature, filename, panels, path: new URL(page.url()).pathname + new URL(page.url()).search, visibleText: body.slice(0, 6500) });
  console.log(`Captured ${id}: ${feature}`);
}
try {
  await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
  // The SSR form can submit a native GET before React attaches its handler.
  await page.waitForFunction(() => {
    const form = document.querySelector("form");
    return form && Object.keys(form).some((key) => key.startsWith("__reactProps$"));
  }, undefined, { timeout: 45000 });
  await page.locator('input[name="email"]').fill(DEMO_EMAIL);
  await page.locator('input[name="password"]').fill(DEMO_PASSWORD);
  const [signIn] = await Promise.all([
    page.waitForResponse((response) => new URL(response.url()).pathname === "/auth/v1/token", { timeout: 45000 }),
    page.getByRole("button", { name: "Продолжить", exact: true }).click(),
  ]);
  if (signIn.status() !== 200) throw new Error(`Local sign-in failed: ${signIn.status()}`);
  report.localSignInStatus = signIn.status();
  // Auth is verified independently of the development router's transition.
  // visit() opens a fresh page with the same context/cookies after they settle.
  await page.waitForTimeout(1000);
  const authenticatedCookies = await context.cookies();
  console.log("Local sign-in verified: 200");
  await visit("/dashboard", "Последняя зарядка");
  await page.locator("#park-estimate-provider").click();
  await page.getByRole("option", { name: "Home", exact: true }).click();
  await capture("01-dashboard", "Главная: SOC, пробег, последняя поездка и зарядка");
  await visit("/history?tab=charging");
  await page.getByRole("button", { name: "Добавить пропущенную зарядку", exact: true }).waitFor();
  await capture("03-charging-history", "История зарядок");
  await page.getByRole("button", { name: "Добавить пропущенную зарядку", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  await capture("02-manual-charge", "Добавление зарядки по чеку — форма без сохранения");
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  if (!process.argv.includes("--skip-detail")) {
    await visit(`/history/${charges.at(-1).id}`);
    await page.locator("#session-provider-type").waitFor();
    await capture("04-charge-detail", "Завершённая зарядка: энергия, стоимость, график");
  }
  await visit("/history?tab=trips", "34.0 km"); await capture("05-trips", "История поездок");
  await visit("/history?tab=analytics&range=month", "Месяц в цифрах"); await capture("06-analytics", "Аналитика поездок и расходов");
  await visit("/vehicle", "BYD Yuan Up"); await capture("07-vehicle", "Состояние автомобиля");
  await visit("/vehicle?tab=service", "Замена салонного фильтра"); await capture("08-service", "Сервисный журнал");
  const stats = page.getByRole("button", { name: "Статистика", exact: true });
  if (await stats.count()) { await stats.click(); await page.waitForTimeout(600); await capture("09-service-stats", "Расходы на обслуживание"); }
  await visit("/settings", "BYD Yuan Up"); await capture("10-settings", "Настройки, автомобиль и тарифы");
  await visit(`/cars/${DEMO_CAR_ID}/edit`, "Полезная батарея"); await capture("11-car-settings", "Параметры батареи и эффективности");
  // Knowledge is public. Capture its anonymous experience, independently of
  // authenticated car-generation auto-detection; restore local auth below.
  await context.clearCookies();
  await visit("/knowledge?gen=gen1_2024", "Как читать стоимость зарядки"); await capture("12-knowledge", "База знаний");
  await visit("/knowledge/article/demo-charge-cost", "От процента к энергии"); await capture("13-article", "Статья базы знаний");
  // Exercise the public chrome's navigation rather than depending on initial
  // query-parameter hydration while authenticated generation state settles.
  await visit("/knowledge?gen=gen1_2024", "Как читать стоимость зарядки");
  await page.getByRole("button", { name: "Открыть Вопросы", exact: true }).click();
  await page.getByText("Можно ли пользоваться VoltFlow", { exact: false }).first().waitFor();
  await capture("14-faq", "Вопросы и ответы");
  await page.getByRole("button", { name: "Открыть Калькулятор", exact: true }).click();
  await page.getByText("Калькулятор зарядки", { exact: false }).first().waitFor();
  await capture("15-tools", "Дополнительные инструменты");
  await page.getByRole("button", { name: "Открыть Каталог", exact: true }).click();
  await page.getByText("Органайзер багажника", { exact: false }).first().waitFor();
  await capture("16-accessories", "Каталог аксессуаров");
  await page.getByRole("button", { name: "Запчасти", exact: true }).click();
  await page.getByText("Салонный фильтр — демо", { exact: false }).first().waitFor();
  await capture("17-spare-parts", "Каталог запчастей");
  await page.getByRole("button", { name: "Сервис", exact: true }).click();
  await page.getByText("Демо-сервис BYD", { exact: false }).first().waitFor();
  await capture("18-service-catalog", "Каталог сервисов");
  await context.addCookies(authenticatedCookies);
  execFileSync(process.execPath, [resolve(root, "scripts/telegram-demo-seed.mjs"), "--charging"], {
    cwd: root, stdio: "ignore",
  });
  await visit("/dashboard", "BYD Yuan Up"); await capture("19-live-charging", "Активная зарядка — имитация локального состояния");
  await visit("/vehicle", "BYD YUAN UP"); await capture("20-charging-vehicle", "Телеметрия активной зарядки — имитация");
  report.complete = report.screens.length === 20 && !report.browserErrors.length && !report.failedLocal.length &&
    !process.argv.includes("--skip-detail") &&
    report.externalRequests.every((request) => request.origin === "https://va.vercel-scripts.com");
} catch (error) {
  report.browserErrors.push(error.message); console.error(error.message);
  report.failurePath = new URL(page.url()).pathname;
  report.failureText = (await page.locator("body").innerText().catch(() => "")).slice(0, 1200);
  await page.screenshot({ path: resolve(output, "failed-screen.png") }).catch(() => {});
}
finally {
  report.browserErrors = [...new Set(report.browserErrors)]; report.failedLocal = [...new Set(report.failedLocal)];
  writeFileSync(resolve(output, "manifest.json"), JSON.stringify(report, null, 2) + "\n"); await browser.close();
  execFileSync(process.execPath, [resolve(root, "scripts/telegram-demo-seed.mjs")], { cwd: root, stdio: "ignore" });
}
console.log(`Capture complete=${report.complete}; screens=${report.screens.length}; local errors=${report.failedLocal.length}; browser errors=${report.browserErrors.length}`);
if (!report.complete) process.exitCode = 1;
