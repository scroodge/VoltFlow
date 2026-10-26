import assert from "node:assert/strict";
import { test } from "node:test";

import { getServiceMapHref } from "./service-map-link.ts";

test("generates Yandex maps link for CIS languages", () => {
  const href = getServiceMapHref("Minsk, Central St", "ru-RU", "UTC");
  assert.equal(href, "https://yandex.com/maps/?text=Minsk%2C%20Central%20St");
});

test("generates Yandex maps link for CIS timezones even if language is en", () => {
  const href = getServiceMapHref("Minsk, Central St", "en-US", "Europe/Minsk");
  assert.equal(href, "https://yandex.com/maps/?text=Minsk%2C%20Central%20St");
});

test("generates Google maps link for non-CIS language and timezone", () => {
  const href = getServiceMapHref("123 Main St", "en-US", "America/New_York");
  assert.equal(href, "https://www.google.com/maps/search/?api=1&query=123%20Main%20St");
});
