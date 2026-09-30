#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { DEMO_EMAIL, DEMO_PASSWORD } from "./fixtures/telegram-demo.mjs";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "docs/marketing/telegram-launch/screenshots");
const origin = "http://127.0.0.1:3037";
mkdirSync(output, { recursive: true });
// Refresh the relative dates and live snapshot immediately before capture.
execFileSync(process.execPath, [resolve(root, "scripts/telegram-demo-seed.mjs")], {
  cwd: root,
  stdio: "ignore",
});

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: "ru-BY",
  timezoneId: "Europe/Minsk",
  colorScheme: "dark",
});
const blocked = [];
const failedLocal = [];
await context.route("**/*", async (route) => {
  const url = new URL(route.request().url());
  if (["127.0.0.1", "localhost"].includes(url.hostname)) {
    await route.continue();
  } else {
    blocked.push(url.origin);
    await route.abort();
  }
});

const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error" && !message.text().includes("net::ERR_FAILED")) {
    errors.push(message.text());
  }
});
page.on("response", (response) => {
  if (response.url().startsWith(origin) && response.status() >= 400) {
    failedLocal.push(`${response.status()} ${new URL(response.url()).pathname}`);
  }
});

try {
  await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="email"]').fill(DEMO_EMAIL);
  await page.locator('input[name="password"]').fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  await page.waitForTimeout(1800);
  console.log(`After sign-in: ${page.url()}`);
  const capture = async (name, filename) => {
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);
    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    console.log(`${name}: ${body.slice(0, 950)}`);
    await page.screenshot({ path: resolve(output, filename), animations: "disabled" });
  };
  await page.goto(`${origin}/settings`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1600);
  await capture("settings", "05-settings.png");
  await page.goto(`${origin}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.getByText("ПОСЛЕДНЯЯ ЗАРЯДКА").waitFor();
  await capture("dashboard", "01-dashboard.png");
  await page.goto(`${origin}/history`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Зарядка", exact: true }).click();
  await capture("charges", "02-charging-history.png");
  await page.locator('a[href^="/history/"]').first().click();
  await capture("charge detail", "03-charge-detail.png");
  await page.goto(`${origin}/history`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Поездки", exact: true }).click();
  await capture("trips", "04-trips.png");
  console.log(`Blocked external origins: ${[...new Set(blocked)].join(", ") || "none"}`);
  console.log(`Local HTTP errors: ${[...new Set(failedLocal)].join(", ") || "none"}`);
  console.log(`Browser errors: ${errors.length ? errors.join(" | ") : "none"}`);
  if (errors.length || failedLocal.length) process.exitCode = 1;
} finally {
  await browser.close();
}
