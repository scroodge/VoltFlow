#!/usr/bin/env node
/**
 * Seed the two knowledge-base gaps recorded in BACKLOG.md:
 *   «как заряжать зимой»      → winter-charging
 *   «чем отличается AC от DC» → ac-vs-dc
 *
 * Both are questions the relevance eval (`npm run search:eval`) currently passes
 * only by correctly refusing to answer. The static corpus in
 * src/data/telegram/ has English stubs for these, but that file is a fallback —
 * the live site reads Postgres, which had neither topic in Russian.
 *
 * Why a script and not a migration: an article is not just a row. Semantic
 * search reads `knowledge_items`, which carries a 1536-dim
 * text-embedding-3-small vector built by `buildKnowledgeEmbeddingText`. A plain
 * SQL insert would create articles that are invisible to search — worse than
 * not having them, because they would look present while never being retrieved.
 * This mirrors what `createArticle` + `upsertArticleKnowledgeItem` do at runtime.
 *
 * Idempotent: re-running updates the same rows, matched on slug.
 *
 * Usage:
 *   node scripts/seed-knowledge-articles.mjs            # inserts as DRAFT
 *   node scripts/seed-knowledge-articles.mjs --publish  # inserts as published
 *
 * Draft is the default deliberately: this is public-facing content. Review it in
 * /admin/knowledge first, then publish.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

// --- env -------------------------------------------------------------------

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    let raw;
    try {
      raw = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const match = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
      if (!match) continue;
      const [, key, value] = match;
      if (!process.env[key]) {
        process.env[key] = value.replace(/^["']|["']$/g, "");
      }
    }
  }
}

loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

for (const [name, value] of Object.entries({
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  OPENAI_API_KEY: OPENAI_KEY,
})) {
  if (!value) {
    console.error(`Missing ${name}. Add it to .env.local and retry.`);
    process.exit(1);
  }
}

const publish = process.argv.includes("--publish");
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const openai = new OpenAI({ apiKey: OPENAI_KEY });

/**
 * Both tables carry `check (cardinality(model_generations) > 0 and ... <@
 * array['gen1_2024','gen2_2025'])`, so an empty array is rejected outright.
 * Both topics are generation-agnostic, and `GenerationFilteredArticles` hides
 * articles that do not match the reader's selected generation — so listing both
 * is what keeps them visible to everyone, not just a default.
 */
const GENERATIONS = ["gen1_2024", "gen2_2025"];

// --- content ---------------------------------------------------------------
// Deliberately conservative on car-specific numbers. The efficiency figures are
// VoltFlow's own measured values (see AGENTS.md): AC ≈98%, fast DC ≈90%.

const ARTICLES = [
  {
    slug: "winter-charging",
    categorySlug: "winter",
    title: "Как заряжать зимой",
    summary:
      "Почему зимой зарядка идет медленнее, сколько энергии уходит на прогрев и что реально помогает сократить время на морозе.",
    tags: ["зима", "холод", "зарядка", "запас хода", "прогрев батареи"],
    sections: [
      {
        heading: "Почему зимой медленнее",
        body:
          "Литиевая батарея — это химия, а химические реакции на холоде идут неохотно. При низкой температуре ячеек внутреннее сопротивление растет, и система управления батареей (BMS) намеренно ограничивает ток заряда, чтобы не повредить ячейки. Это не поломка и не деградация: то же самое происходит с любым электромобилем.\n\nПрактический эффект: на морозе машина может принимать заметно меньше киловатт, чем летом, особенно в первые минуты. На переменном токе (AC) разница обычно меньше, потому что мощность и так невелика. На быстрой зарядке (DC) разница видна сильнее всего — холодная батарея просто не даст выйти на максимум.",
      },
      {
        heading: "Куда уходит энергия",
        body:
          "Зимой часть энергии не попадает в батарею, а тратится на обогрев — самой батареи и салона. Поэтому в мороз кВт·ч, снятые со счетчика, и прирост процентов на приборной панели расходятся сильнее, чем летом.\n\nВторая статья расхода — отопление салона в поездке. Оно почти не влияет на саму зарядку, но заметно влияет на запас хода, и эти две вещи легко перепутать. Если кажется, что «батарея стала хуже», сравнивайте расход за поездку, а не только время зарядки.",
      },
      {
        heading: "Что реально помогает",
        body:
          "Заряжайте сразу после поездки. Батарея после езды уже теплая, и это лучший момент для зарядки — особенно для быстрой DC. Приехать на зарядную станцию на холодной машине после ночной стоянки — худший сценарий по времени.\n\nСтавьте машину на зарядку на ночь дома. Медленная AC-зарядка зимой почти не теряет в скорости, а к утру батарея будет и заряжена, и не переохлаждена.\n\nПрогревайте салон от сети. Если машина стоит подключенной, прогрев идет от розетки, а не из батареи — вы выезжаете с полным запасом хода и теплым салоном.\n\nНе гоняйтесь за 100% на морозе. Последние проценты зимой набираются особенно медленно.",
      },
      {
        heading: "Чего делать не нужно",
        body:
          "Не пытайтесь «разогреть» батарею агрессивной ездой перед зарядкой — выигрыш во времени зарядки съедается расходом на саму поездку.\n\nНе делайте выводов о деградации по одной зимней зарядке. Емкость оценивают в сопоставимых условиях: похожая температура, похожий диапазон процентов. Зимние цифры сравнивайте с зимними.",
      },
    ],
    tips: [
      "Лучшее время для быстрой зарядки зимой — сразу после поездки, пока батарея теплая.",
      "Если машина стоит у розетки, прогревайте салон от сети: запас хода останется нетронутым.",
      "Сравнивайте зимний расход с зимним, а не с летним — иначе легко напридумывать деградацию.",
    ],
    warnings: [
      "На сильном морозе быстрая зарядка может идти заметно медленнее заявленной мощности. Это штатное поведение BMS, а не неисправность станции.",
    ],
  },
  {
    slug: "ac-vs-dc",
    categorySlug: "charging",
    title: "Чем отличается AC от DC",
    summary:
      "Переменный и постоянный ток: где находится зарядное устройство, почему скорость отличается в разы и что выбирать в каждой ситуации.",
    tags: ["AC", "DC", "быстрая зарядка", "медленная зарядка", "мощность"],
    sections: [
      {
        heading: "Разница в одном предложении",
        body:
          "В батарее всегда постоянный ток. Вопрос только в том, где стоит преобразователь: при AC-зарядке — внутри машины, при DC-зарядке — внутри станции.\n\nИз этого следует все остальное. Бортовое зарядное устройство должно помещаться в автомобиль и не перегревать его, поэтому его мощность ограничена. Стационарная DC-станция такими ограничениями не связана — она большая, с собственным охлаждением, и может отдавать в разы больше.",
      },
      {
        heading: "AC — переменный ток",
        body:
          "Это домашняя розетка, бытовой кабель и настенный wallbox. Мощность обычно скромная, и потолок задает не станция, а бортовое зарядное устройство машины: более мощная розетка не ускорит процесс, если ограничение внутри автомобиля.\n\nAC — основной сценарий на каждый день. Машина стоит ночью или весь рабочий день, и медленная зарядка перестает быть недостатком: важно не «как быстро», а «готова ли к утру». Дома это к тому же самый дешевый киловатт-час.",
      },
      {
        heading: "DC — постоянный ток",
        body:
          "Это быстрые станции на трассе и в городе. Станция отдает постоянный ток напрямую в батарею, минуя бортовое зарядное устройство, поэтому мощность на порядок выше.\n\nDC — сценарий для дороги, а не для быта. Скорость заметно падает по мере заполнения: чем выше процент, тем сильнее BMS снижает ток. Поэтому в дальней поездке обычно выгоднее два коротких заезда до умеренного процента, чем один долгий до максимума — последние проценты «стоят» непропорционально много времени.",
      },
      {
        heading: "Почему в приложении разная стоимость киловатт-часа",
        body:
          "Энергия по пути в батарею частично теряется — на преобразование и на нагрев. Считать нужно то, за что вы платите: провайдер меряет энергию на своей стороне, а прирост процентов вы видите на стороне батареи.\n\nПотери сильно зависят от типа зарядки. По измерениям VoltFlow, AC-зарядка эффективна примерно на 98%, а быстрая DC — примерно на 90%. Разница не косметическая: если считать быструю зарядку как «стопроцентную», стоимость каждой DC-сессии занижается почти на десятую часть. Поэтому эффективность в приложении задается для тарифа, а не для машины.",
      },
      {
        heading: "Что выбрать",
        body:
          "Дома и на работе — AC. Дешевле, мягче для батареи, и времени стоянки почти всегда достаточно.\n\nВ дороге — DC, до разумного процента, а не до максимума.\n\nЕжедневно ездить на быстрых зарядках только ради экономии времени смысла мало: это дороже и греет батарею сильнее, чем спокойная ночная зарядка.",
      },
    ],
    tips: [
      "Мощность AC-зарядки ограничена бортовым зарядным устройством: более мощная розетка сама по себе не ускорит процесс.",
      "В дальней дороге два коротких DC-заезда обычно быстрее одного долгого до максимума.",
      "Эффективность задается по тарифу, а не по машине: AC ≈98%, быстрая DC ≈90%.",
    ],
    warnings: [
      "Если считать быструю DC-зарядку со стопроцентной эффективностью, реальная стоимость сессии занижается примерно на 10%.",
    ],
  },
];

// --- helpers ---------------------------------------------------------------

function buildEmbeddingText({ title, content, category, tags }) {
  return [
    `Название: ${title}`,
    `Категория: ${category ?? "faq"}`,
    tags?.length ? `Теги: ${tags.join(", ")}` : null,
    `Содержание: ${content}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function flattenForSearch(article) {
  return [
    article.summary,
    ...article.sections.map((s) => `${s.heading}\n${s.body}`),
    ...article.tips.map((t) => `Совет: ${t}`),
    ...article.warnings.map((w) => `Важно: ${w}`),
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function resolveCategoryId(slug) {
  const { data, error } = await supabase
    .from("knowledge_categories")
    .select("id, slug")
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error(`Category "${slug}" not found in knowledge_categories.`);
  return data.id;
}

async function seed(article) {
  const categoryId = await resolveCategoryId(article.categorySlug);
  const status = publish ? "published" : "draft";

  const row = {
    slug: article.slug,
    title: article.title,
    summary: article.summary,
    category_id: categoryId,
    content: article.sections,
    images: [],
    tips: article.tips,
    warnings: article.warnings,
    tags: article.tags,
    model_generations: GENERATIONS,
    status,
    source_label: "Русская база VoltFlow",
    sort_order: 0,
    ...(publish ? { published_at: new Date().toISOString() } : {}),
  };

  const { data, error } = await supabase
    .from("knowledge_articles")
    .upsert(row, { onConflict: "slug" })
    .select("id")
    .single();

  if (error) throw error;
  const id = data.id;

  // knowledge_items is what semantic search actually reads.
  const content = flattenForSearch(article);
  const embeddingText = buildEmbeddingText({
    title: article.title,
    content,
    category: article.categorySlug,
    tags: article.tags,
  });

  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: embeddingText,
  });
  const embedding = response.data[0]?.embedding;
  if (!embedding || embedding.length !== 1536) {
    throw new Error(`Invalid embedding for ${article.slug}`);
  }

  const { error: itemError } = await supabase.from("knowledge_items").upsert({
    id,
    title: article.title,
    content,
    category: article.categorySlug,
    source_type: "article",
    source_url: null,
    telegram_message_id: null,
    source_id: id,
    source_slug: article.slug,
    model_generations: GENERATIONS,
    tags: article.tags,
    embedding,
    is_published: publish,
  });

  if (itemError) throw itemError;

  console.log(
    `  ${article.slug.padEnd(18)} ${status.padEnd(10)} ${content.split(/\s+/).length} words  id=${id}`,
  );
}

// --- run -------------------------------------------------------------------

console.log(`Seeding ${ARTICLES.length} articles as ${publish ? "PUBLISHED" : "DRAFT"}...`);
for (const article of ARTICLES) {
  await seed(article);
}
console.log(
  publish
    ? "Done. Verify with: npm run search:eval"
    : "Done (draft). Review in /admin/knowledge, then re-run with --publish.",
);
