export type TelegramGroupEvent = {
  eventType: "new" | "edited";
  updateId: number | null;
  chatId: string;
  chatType: "group" | "supergroup";
  chatTitle: string | null;
  chatUsername: string | null;
  messageId: number;
  telegramUserId: number | null;
  username: string | null;
  displayName: string | null;
  sentAt: string | null;
  editedAt: string | null;
  text: string;
  replyToMessageId: number | null;
  mediaType: "photo" | "video" | "document" | "audio" | "voice" | "sticker" | null;
  mediaFileId: string | null;
  protectedContent: boolean;
  dedupeKey: string;
  sourceUrl: string | null;
};

type TelegramMessage = {
  message_id?: number;
  date?: number;
  edit_date?: number;
  chat?: {
    id?: number | string;
    type?: string;
    title?: string;
    username?: string;
  };
  from?: {
    id?: number;
    username?: string;
    first_name?: string;
    last_name?: string;
  };
  text?: string;
  caption?: string;
  reply_to_message?: { message_id?: number };
  has_protected_content?: boolean;
  photo?: Array<{ file_id?: string }>;
  video?: { file_id?: string };
  document?: { file_id?: string };
  audio?: { file_id?: string };
  voice?: { file_id?: string };
  sticker?: { file_id?: string };
};

export function normalizeTelegramGroupUpdate(update: {
  update_id?: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}): TelegramGroupEvent | null {
  const eventType = update.edited_message ? "edited" : "new";
  const message = update.edited_message ?? update.message;
  const chat = message?.chat;
  const messageId = message?.message_id;
  const chatId = chat?.id;

  if (
    !message
    || !chat
    || (chat.type !== "group" && chat.type !== "supergroup")
    || messageId == null
    || chatId == null
  ) {
    return null;
  }

  const text = (message.text ?? message.caption ?? "").trim();
  const media = resolveMedia(message);
  const chatUsername = cleanUsername(chat.username);
  const sentAt = unixSecondsToIso(message.date);
  const editedAt = unixSecondsToIso(message.edit_date);

  return {
    eventType,
    updateId: typeof update.update_id === "number" ? update.update_id : null,
    chatId: String(chatId),
    chatType: chat.type,
    chatTitle: message.chat?.title?.trim() || null,
    chatUsername,
    messageId,
    telegramUserId: typeof message.from?.id === "number" ? message.from.id : null,
    username: cleanUsername(message.from?.username),
    displayName: [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ") || null,
    sentAt,
    editedAt,
    text,
    replyToMessageId: typeof message.reply_to_message?.message_id === "number"
      ? message.reply_to_message.message_id
      : null,
    mediaType: media?.type ?? null,
    mediaFileId: media?.fileId ?? null,
    protectedContent: message.has_protected_content === true,
    dedupeKey: `${chatId}:${messageId}`,
    sourceUrl: chatUsername ? `https://t.me/${chatUsername}/${messageId}` : null,
  };
}

function cleanUsername(username: string | undefined) {
  const value = username?.trim().replace(/^@/, "");
  return value || null;
}

function unixSecondsToIso(value: number | undefined) {
  return typeof value === "number" ? new Date(value * 1000).toISOString() : null;
}

function resolveMedia(message: TelegramMessage) {
  if (message.photo?.length) {
    const fileId = message.photo.at(-1)?.file_id;
    return fileId ? { type: "photo" as const, fileId } : null;
  }
  for (const [type, media] of [
    ["video", message.video],
    ["document", message.document],
    ["audio", message.audio],
    ["voice", message.voice],
    ["sticker", message.sticker],
  ] as const) {
    if (media?.file_id) return { type, fileId: media.file_id };
  }
  return null;
}
