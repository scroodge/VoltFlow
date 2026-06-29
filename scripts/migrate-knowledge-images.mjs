#!/usr/bin/env node
/**
 * Migrate knowledge CMS images from old Supabase project domain to current.
 *
 * Usage:
 *   node --env-file=.env.local scripts/migrate-knowledge-images.mjs
 *   node --env-file=.env.local scripts/migrate-knowledge-images.mjs --dry-run
 */

import { createClient } from "@supabase/supabase-js";

const CURRENT_SUPABASE_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const isDryRun = process.argv.includes("--dry-run");

if (!CURRENT_SUPABASE_BASE || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(CURRENT_SUPABASE_BASE, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let scanned = 0;
let alreadyCurrent = 0;
let needsMigrate = 0;
let uploaded = 0;
let updated = 0;
let errors = 0;

function parseStorageUrl(url) {
  const m = url.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)/);
  if (!m) return null;
  return { bucket: m[1], path: m[2] };
}

function usesCurrentDomain(url) {
  return url.startsWith(CURRENT_SUPABASE_BASE);
}

function toCurrentStorageUrl(bucket, path) {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

async function download(url) {
  console.log(`  Downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`  Download failed (${res.status})`);
    return null;
  }
  const buf = await res.arrayBuffer();
  const contentType = res.headers.get("content-type") || "image/jpeg";
  return { buffer: Buffer.from(buf), contentType };
}

async function uploadToCurrent(bucket, path, buffer, contentType) {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, buffer, { contentType, upsert: true });
  if (error) {
    console.error(`  Upload error: ${error.message}`);
    return null;
  }
  return toCurrentStorageUrl(bucket, path);
}

/**
 * For a list of image URLs, finds those that need migration,
 * downloads & re-uploads them, and returns a mapping from old->new URL.
 */
async function migrateUrls(urls) {
  const mapping = {};

  for (const url of urls) {
    scanned++;
    if (!url) continue;

    const parsed = parseStorageUrl(url);
    if (!parsed) {
      console.warn(`  Skipping unparseable URL: ${url.substring(0, 80)}`);
      continue;
    }

    if (usesCurrentDomain(url)) {
      alreadyCurrent++;
      continue;
    }

    needsMigrate++;
    console.log(`  NEEDS MIGRATE: ${url}`);

    if (isDryRun) {
      console.log(`  (dry-run, would download & re-upload)`);
      continue;
    }

    const dl = await download(url);
    if (!dl) { errors++; continue; }

    const newUrl = await uploadToCurrent(parsed.bucket, parsed.path, dl.buffer, dl.contentType);
    if (!newUrl) { errors++; continue; }

    uploaded++;
    console.log(`  Uploaded -> ${newUrl}`);
    mapping[url] = newUrl;
  }

  return mapping;
}

function replaceUrlInArray(arr, mapping) {
  return arr.map((img) => {
    if (mapping[img.url]) {
      return { ...img, url: mapping[img.url] };
    }
    return img;
  });
}

function replaceUrlInContent(content, mapping) {
  return content.map((section) => {
    if (!section.images?.length) return section;
    return { ...section, images: replaceUrlInArray(section.images, mapping) };
  });
}

// --- Process each table ---

async function processKnowledgeArticles() {
  console.log("\n=== knowledge_articles ===");
  const { data, error } = await supabase
    .from("knowledge_articles")
    .select("id, slug, images, content");
  if (error) { console.error(error.message); return; }

  for (const row of data) {
    const allOldUrls = [
      ...(row.images || []).map((i) => i.url).filter(Boolean),
      ...(row.content || []).flatMap((s) => (s.images || []).map((i) => i.url).filter(Boolean)),
    ];

    if (!allOldUrls.length) continue;
    if (allOldUrls.every(usesCurrentDomain)) continue;

    const mapping = await migrateUrls(allOldUrls);
    if (!Object.keys(mapping).length) continue;

    const updates = {};
    const newImages = replaceUrlInArray(row.images || [], mapping);
    if (JSON.stringify(newImages) !== JSON.stringify(row.images)) {
      updates.images = newImages;
    }

    const newContent = replaceUrlInContent(row.content || [], mapping);
    if (JSON.stringify(newContent) !== JSON.stringify(row.content)) {
      updates.content = newContent;
    }

    if (!Object.keys(updates).length) continue;

    updated++;
    await supabase.from("knowledge_articles").update(updates).eq("id", row.id);
    console.log(`  Updated article "${row.slug}"`);
  }
}

async function processAccessories() {
  console.log("\n=== accessories ===");
  const { data, error } = await supabase
    .from("accessories")
    .select("id, title, image_url");
  if (error) { console.error(error.message); return; }

  for (const row of data) {
    if (!row.image_url || usesCurrentDomain(row.image_url)) continue;

    const mapping = await migrateUrls([row.image_url]);
    if (!mapping[row.image_url]) continue;

    updated++;
    await supabase.from("accessories").update({ image_url: mapping[row.image_url] }).eq("id", row.id);
    console.log(`  Updated accessory "${row.title}"`);
  }
}

async function processSpareParts() {
  console.log("\n=== spare_parts ===");
  const { data, error } = await supabase
    .from("spare_parts")
    .select("id, title, images");
  if (error) { console.error(error.message); return; }

  for (const row of data) {
    const urls = (row.images || []).map((i) => i.url).filter(Boolean);
    if (!urls.length || urls.every(usesCurrentDomain)) continue;

    const mapping = await migrateUrls(urls);
    if (!Object.keys(mapping).length) continue;

    const newImages = replaceUrlInArray(row.images || [], mapping);
    updated++;
    await supabase.from("spare_parts").update({ images: newImages }).eq("id", row.id);
    console.log(`  Updated spare_part "${row.title}"`);
  }
}

// --- Main ---

async function main() {
  console.log(`Current Supabase: ${CURRENT_SUPABASE_BASE}`);
  console.log(`Dry run: ${isDryRun}\n`);

  await processKnowledgeArticles();
  await processAccessories();
  await processSpareParts();

  console.log("\n=== Summary ===");
  console.log(`Scanned:         ${scanned}`);
  console.log(`Already current: ${alreadyCurrent}`);
  console.log(`Needs migrate:   ${needsMigrate}`);
  console.log(`Uploaded:        ${uploaded}`);
  console.log(`DB updated row:  ${updated}`);
  console.log(`Errors:          ${errors}`);
}

main().catch(console.error);
