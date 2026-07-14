export type TelegramContextIntent =
  | "sell"
  | "wanted"
  | "service"
  | "question"
  | "irrelevant"
  | "ambiguous";

export type TelegramContextVerification = {
  intent: TelegramContextIntent;
  confidence: number;
  title: string | null;
  itemType: "accessory" | "spare_part" | "service" | "car" | "other" | null;
  city: string | null;
  generation: string | null;
  price: number | null;
  currency: string | null;
  contact: string | null;
  actionable: boolean;
  needsReview: boolean;
  reason: string;
};

type LlmConfig = {
  baseUrl: string;
  model: string;
  apiKey: string;
  maxTokens: number;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const INTENTS = new Set<TelegramContextIntent>([
  "sell",
  "wanted",
  "service",
  "question",
  "irrelevant",
  "ambiguous",
]);

const ITEM_TYPES = new Set<NonNullable<TelegramContextVerification["itemType"]>>([
  "accessory",
  "spare_part",
  "service",
  "car",
  "other",
]);

const SYSTEM_PROMPT = `You verify Telegram group messages for a BYD Yuan UP community marketplace.
Return ONLY one valid JSON object. Do not use markdown fences or extra text.

Schema:
{
  "intent": "sell" | "wanted" | "service" | "question" | "irrelevant" | "ambiguous",
  "confidence": number from 0 to 1,
  "title": string or null,
  "item_type": "accessory" | "spare_part" | "service" | "car" | "other" | null,
  "city": string or null,
  "generation": string or null,
  "price": number or null,
  "currency": string or null,
  "contact": string or null,
  "actionable": boolean,
  "needs_review": boolean,
  "reason": string
}

Rules:
- sell means the author offers something for sale.
- wanted means the author wants to buy or find something.
- service means the author offers or requests a repair/service.
- question means a technical or informational question for the knowledge base.
- irrelevant means it is not useful to the marketplace or knowledge base.
- ambiguous means the intent cannot be determined safely.
- Never invent a city, price, generation, contact, or product detail.
- Set needs_review true when the message is ambiguous, promotional, unsafe, or lacks enough context.
- actionable is true only for a clear sell, wanted, or service message.
- Keep title short and based only on the message.
- Preserve the author's currency when present; otherwise use null.`;

export function getLlmConfig(env: Record<string, string | undefined> = process.env): LlmConfig {
  const configuredBaseUrl = env.LLM_BASE_URL?.trim().replace(/\/$/, "");
  const model = env.LLM_MODEL?.trim();
  const apiKey = env.LLM_API_KEY?.trim();
  const maxTokens = Number(env.LLM_MAX_TOKENS ?? "512");

  if (!configuredBaseUrl || !model || !apiKey) {
    throw new Error("Missing LLM_BASE_URL, LLM_MODEL, or LLM_API_KEY.");
  }
  if (!Number.isInteger(maxTokens) || maxTokens < 64 || maxTokens > 4096) {
    throw new Error("LLM_MAX_TOKENS must be an integer between 64 and 4096.");
  }

  const baseUrl = configuredBaseUrl.endsWith("/v1")
    ? configuredBaseUrl
    : `${configuredBaseUrl}/v1`;

  return { baseUrl, model, apiKey, maxTokens };
}

export function reviewFallback(reason: string): TelegramContextVerification {
  return {
    intent: "ambiguous",
    confidence: 0,
    title: null,
    itemType: null,
    city: null,
    generation: null,
    price: null,
    currency: null,
    contact: null,
    actionable: false,
    needsReview: true,
    reason,
  };
}

export async function verifyTelegramContext(
  message: string,
  options: {
    env?: Record<string, string | undefined>;
    fetchImpl?: FetchLike;
  } = {},
): Promise<TelegramContextVerification> {
  const text = message.trim();
  if (!text) return reviewFallback("empty_message");

  let config: LlmConfig;
  try {
    config = getLlmConfig(options.env);
  } catch (error) {
    return reviewFallback(error instanceof Error ? error.message : "llm_not_configured");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        max_tokens: config.maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
      }),
    });
  } catch {
    return reviewFallback("llm_request_failed");
  }

  if (!response.ok) return reviewFallback(`llm_http_${response.status}`);

  try {
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return reviewFallback("llm_empty_response");
    return parseVerification(content);
  } catch {
    return reviewFallback("llm_invalid_response");
  }
}

export function parseVerification(content: string): TelegramContextVerification {
  const json = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return reviewFallback("llm_invalid_json");
  }

  const intent = INTENTS.has(value.intent as TelegramContextIntent)
    ? (value.intent as TelegramContextIntent)
    : "ambiguous";
  const confidence = typeof value.confidence === "number"
    ? Math.max(0, Math.min(1, value.confidence))
    : 0;
  const itemType = ITEM_TYPES.has(value.item_type as NonNullable<TelegramContextVerification["itemType"]>)
    ? (value.item_type as NonNullable<TelegramContextVerification["itemType"]>)
    : null;
  const needsReview = value.needs_review === true || intent === "ambiguous" || confidence < 0.75;
  const actionable = value.actionable === true
    && ["sell", "wanted", "service"].includes(intent)
    && !needsReview;

  return {
    intent,
    confidence,
    title: stringOrNull(value.title),
    itemType,
    city: stringOrNull(value.city),
    generation: stringOrNull(value.generation),
    price: numberOrNull(value.price),
    currency: stringOrNull(value.currency),
    contact: stringOrNull(value.contact),
    actionable,
    needsReview,
    reason: stringOrNull(value.reason) ?? "No explanation returned.",
  };
}

export function isPublishableVerification(result: TelegramContextVerification) {
  return result.actionable && !result.needsReview && result.confidence >= 0.75;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
