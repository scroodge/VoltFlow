const CIS_LANGUAGES = ["ru", "be", "kk", "uk", "uz", "hy", "az", "ky", "tg", "tk", "mo"];
const CIS_TIMEZONES = [
  "Europe/Minsk",
  "Europe/Moscow",
  "Europe/Kyiv",
  "Europe/Chisinau",
  "Asia/Almaty",
  "Asia/Aqtobe",
  "Asia/Tashkent",
  "Asia/Bishkek",
  "Asia/Dushanbe",
  "Asia/Yerevan",
  "Asia/Baku",
  "Asia/Ashgabat",
];

export function getServiceMapHref(address: string, language: string, timezone: string): string {
  const lang = language.toLowerCase().split("-")[0];
  const isCis = CIS_LANGUAGES.includes(lang) || CIS_TIMEZONES.includes(timezone);
  const encoded = encodeURIComponent(address);
  return isCis
    ? `https://yandex.com/maps/?text=${encoded}`
    : `https://www.google.com/maps/search/?api=1&query=${encoded}`;
}
