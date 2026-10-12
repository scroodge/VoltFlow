#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const folder = resolve(import.meta.dirname, "../docs/marketing/telegram-launch/screenshots/current");
const report = JSON.parse(readFileSync(resolve(folder, "manifest.json"), "utf8"));
const escape = (text) => String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const content = report.screens.map((screen) => `<section><h2>${escape(screen.id)} · ${escape(screen.feature)}</h2><div class="images">${[screen.filename, ...(screen.panels ?? [])].map((file) => `<figure><a href="${escape(file)}"><img src="${escape(file)}" loading="lazy" alt="${escape(screen.feature)}"></a><figcaption>${escape(file)}</figcaption></figure>`).join("")}</div></section>`).join("\n");
writeFileSync(resolve(folder, "gallery.html"), `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VoltFlow FAQ · демо-экраны</title><style>body{background:#11151c;color:#eee;font:16px system-ui;margin:24px}h1,h2{font-weight:600}.images{display:flex;gap:16px;flex-wrap:wrap}figure{margin:0}img{width:260px;max-width:90vw;border:1px solid #334;border-radius:12px}figcaption{font-size:12px;margin:8px 0 24px;color:#abb}p{max-width:800px}</style><h1>VoltFlow · @voltflowfaq</h1><p>Демонстрационные данные. ${escape(report.capturedAt)}. Проверка: ${report.complete ? "пройдена" : "не завершена — см. manifest.json"}. Реальная связь с автомобилем и Telegram не проверялась.</p>${content}</html>\n`);
console.log(`Gallery: ${report.screens.length} screens.`);
