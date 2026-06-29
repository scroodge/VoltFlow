"use client";

export function isTelegramWebView() {
  if (typeof window === "undefined") return false;
  if (window.Telegram?.WebApp?.initData) return true;
  return /\bTelegram\b/i.test(window.navigator.userAgent);
}
