#!/usr/bin/env node
/**
 * Mint a webhook-telemetry token for one (user, vehicle) — e.g. for AndyShaman/BYDMate's
 * Settings → "Webhook — telemetry" URL field. Prints the plaintext token and the full
 * POST URL once; only the HMAC hash is stored.
 *
 *   node --env-file=.env.local scripts/mint-bydmate-webhook-token.mjs \
 *     --email user@example.com --vehicle way \
 *     [--label "AndyShaman BYDMate test"] [--site https://voltflow.life]
 */
import { createClient } from "@supabase/supabase-js";
import {
  generateWebhookToken,
  hashWebhookToken,
} from "../src/lib/voltflowmate/webhook-token-auth.ts";

function arg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const email = arg("email");
const vehicleId = arg("vehicle");
const label = arg("label") ?? null;
const site = arg("site") ?? "https://voltflow.life";

if (!email || !vehicleId) {
  console.error(
    "Usage: --email <user@example.com> --vehicle <vehicle_id> [--label <text>] [--site <base-url>]",
  );
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key);

const { data: profile, error: profileError } = await supabase
  .from("profiles")
  .select("id")
  .eq("email", email)
  .maybeSingle();

if (profileError) {
  console.error(profileError.message);
  process.exit(1);
}
if (!profile) {
  console.error(`No profile found for ${email}`);
  process.exit(1);
}

const token = generateWebhookToken();
const tokenHash = hashWebhookToken(token);

const { error: insertError } = await supabase.from("bydmate_webhook_tokens").insert({
  user_id: profile.id,
  vehicle_id: vehicleId,
  token_hash: tokenHash,
  label,
});

if (insertError) {
  console.error(insertError.message);
  process.exit(1);
}

console.log("Token minted. This is shown once — it is not recoverable from the database.");
console.log("");
console.log(`Webhook URL: ${site}/api/bydmate/webhook-telemetry/${token}`);
console.log("Secret field in the sender app: leave blank (the URL itself is the credential).");
