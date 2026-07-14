import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTelegramGroupUpdate } from "./telegram-group-message.ts";

test("normalizes a seller group message", () => {
  const result = normalizeTelegramGroupUpdate({
    update_id: 42,
    message: {
      message_id: 17,
      date: 1784035000,
      chat: { id: -100123, type: "supergroup", title: "BYD Yuan UP", username: "yuanup" },
      from: { id: 99, username: "seller", first_name: "Андрей", last_name: "К" },
      text: "Продам аккумулятор AGM 40",
    },
  });

  assert.deepEqual(result, {
    eventType: "new",
    updateId: 42,
    chatId: "-100123",
    chatType: "supergroup",
    chatTitle: "BYD Yuan UP",
    chatUsername: "yuanup",
    messageId: 17,
    telegramUserId: 99,
    username: "seller",
    displayName: "Андрей К",
    sentAt: "2026-07-14T13:16:40.000Z",
    editedAt: null,
    text: "Продам аккумулятор AGM 40",
    replyToMessageId: null,
    mediaType: null,
    mediaFileId: null,
    protectedContent: false,
    dedupeKey: "-100123:17",
    sourceUrl: "https://t.me/yuanup/17",
  });
});

test("uses edited captions and the largest photo file id", () => {
  const result = normalizeTelegramGroupUpdate({
    update_id: 43,
    edited_message: {
      message_id: 18,
      edit_date: 1784035060,
      chat: { id: -100123, type: "group" },
      caption: "Цена исправлена: 250 BYN",
      photo: [{ file_id: "small" }, { file_id: "large" }],
      reply_to_message: { message_id: 10 },
      has_protected_content: true,
    },
  });

  assert.equal(result?.eventType, "edited");
  assert.equal(result?.text, "Цена исправлена: 250 BYN");
  assert.equal(result?.mediaType, "photo");
  assert.equal(result?.mediaFileId, "large");
  assert.equal(result?.replyToMessageId, 10);
  assert.equal(result?.protectedContent, true);
  assert.equal(result?.sourceUrl, null);
});

test("ignores private chats, channels, and updates without a message id", () => {
  assert.equal(normalizeTelegramGroupUpdate({ message: { chat: { id: 1, type: "private" }, message_id: 1 } }), null);
  assert.equal(normalizeTelegramGroupUpdate({ message: { chat: { id: 1, type: "channel" }, message_id: 1 } }), null);
  assert.equal(normalizeTelegramGroupUpdate({ message: { chat: { id: 1, type: "group" } } }), null);
});
