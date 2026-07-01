// Donation / premium support configuration. Level-1 flow: users pay via one of
// the channels below, then send a receipt (screenshot/PDF) to the Telegram bot
// or email; an admin then grants premium in /admin/users.
//
// ⚠️ FILL THESE IN before shipping — the card numbers and bot link are
// placeholders. Everything else (buymeacoffee, email) is live.

export type SupportCard = {
  /** Card number, shown verbatim and copyable. */
  number: string;
  /** Bank name / label. */
  bank: string;
};

/** Bank cards for transfers (primarily RU/BY users). TODO: real numbers. */
export const SUPPORT_CARDS: readonly SupportCard[] = [
  { number: "XXXX XXXX XXXX XXXX", bank: "БАНК" },
  { number: "XXXX XXXX XXXX XXXX", bank: "БАНК" },
];

/** International tip jar. */
export const SUPPORT_BUYMEACOFFEE_URL = "https://buymeacoffee.com/scroodge";

/** VoltFlow Telegram bot chat where users send receipts. */
export const SUPPORT_TELEGRAM_BOT_URL = "https://t.me/Voltflowscr_bot";

/** Direct deep link to the VoltFlow Telegram Mini App (onboarding entry). */
export const TELEGRAM_MINIAPP_URL = "https://t.me/Voltflowscr_bot/voltflow";

/** Receipts can also go here by email; same inbox as premium upgrade requests. */
export const SUPPORT_EMAIL = "washjurine@gmail.com";
