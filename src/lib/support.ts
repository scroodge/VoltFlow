// Donation / premium support configuration. Level-1 flow: users pay via one of
// the channels below, then send a receipt (screenshot/PDF) to the Telegram bot
// or email; an admin then grants premium in /admin/users.

export type SupportCard = {
  /** Card number, shown verbatim and copyable. */
  number: string;
  /** Bank name / label. */
  bank: string;
};

/**
 * Bank cards for transfers (primarily RU/BY users). Card numbers come from
 * env vars (not secret — meant to be shown publicly for incoming transfers —
 * but keeping them out of source means rotating a card doesn't need a code
 * deploy). Set NEXT_PUBLIC_SUPPORT_CARD_BY / NEXT_PUBLIC_SUPPORT_CARD_RU in
 * Vercel project settings. A card is omitted from the list if its env var
 * isn't set.
 */
export const SUPPORT_CARDS: readonly SupportCard[] = [
  { number: process.env.NEXT_PUBLIC_SUPPORT_CARD_BY ?? "", bank: "BSB Bank  Беларусь" },
  { number: process.env.NEXT_PUBLIC_SUPPORT_CARD_RU ?? "", bank: "Т-Банк, РФ" },
].filter((card) => card.number !== "");

/** International tip jar. */
export const SUPPORT_BUYMEACOFFEE_URL = "https://buymeacoffee.com/scroodge";

/** VoltFlow Telegram bot chat where users send receipts. */
export const SUPPORT_TELEGRAM_BOT_URL = "https://t.me/Voltflowscr_bot";

/** Direct deep link to the VoltFlow Telegram Mini App (onboarding entry). */
export const TELEGRAM_MINIAPP_URL = "https://t.me/Voltflowscr_bot/voltflow";

/** Receipts can also go here by email; same inbox as premium upgrade requests. */
export const SUPPORT_EMAIL = "washjurine@gmail.com";
