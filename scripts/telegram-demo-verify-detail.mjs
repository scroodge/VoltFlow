#!/usr/bin/env node
// Browser regression check against the running, isolated demo; no tariff saves.
import { chromium } from "playwright";
import { DEMO_EMAIL, DEMO_PASSWORD, charges } from "./fixtures/telegram-demo.mjs";

const origin = "http://127.0.0.1:3037";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const errors = [];
await context.route("**/*", (route) => {
  const url = new URL(route.request().url());
  if (["127.0.0.1", "localhost"].includes(url.hostname) && ["3037", "55321"].includes(url.port)) {
    if (url.pathname === "/api/bydmate/latest-release")
      return route.fulfill({ status: 200, contentType: "application/json", body: "null" });
    return route.continue();
  }
  if (url.hostname === "va.vercel-scripts.com")
    return route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
  errors.push(`Unexpected external request: ${url.origin}`);
  return route.abort();
});
function observe(page) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("'upgrade-insecure-requests' is ignored"))
      errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
}
try {
  const login = await context.newPage(); observe(login);
  await login.goto(`${origin}/login`, { waitUntil: "domcontentloaded" });
  await login.waitForFunction(() => {
    const form = document.querySelector("form");
    return form && Object.keys(form).some((key) => key.startsWith("__reactProps$"));
  });
  await login.locator('input[name="email"]').fill(DEMO_EMAIL);
  await login.locator('input[name="password"]').fill(DEMO_PASSWORD);
  const [response] = await Promise.all([
    login.waitForResponse((r) => new URL(r.url()).pathname === "/auth/v1/token"),
    login.getByRole("button", { name: "Продолжить", exact: true }).click(),
  ]);
  if (response.status() !== 200) throw new Error("Demo sign-in failed");
  await login.waitForTimeout(1000); await login.close();
  for (let run = 1; run <= 3; run++) {
    const page = await context.newPage(); observe(page);
    await page.goto(`${origin}/history/${charges.at(-1).id}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.locator("#session-provider-type").waitFor({ timeout: 30000 });
    await page.waitForTimeout(2000);
    for (const selector of ["#session-provider-type", "#session-tariff-type"]) {
      await page.locator(selector).click();
      await page.getByRole("option").first().waitFor();
      await page.keyboard.press("Escape");
    }
    await page.waitForTimeout(2000);
    const body = await page.locator("body").innerText();
    if (/Что-то пошло не так|Maximum update depth|Application error/.test(body))
      throw new Error(`Detail error boundary on run ${run}`);
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(`Detail run ${run}: rendered; both selectors opened; no browser/HTTP errors`);
    await page.close();
  }
} finally { await browser.close(); }
