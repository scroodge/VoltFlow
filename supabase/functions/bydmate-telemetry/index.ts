// Compatibility endpoint for clients that still use the Supabase Edge Function URL.
// The Next.js route is the single telemetry authority: it owns sanitization, persistence
// verification, notifications, Telegram widgets, automatic charging sessions, rollups,
// and reconciliation. Keeping this function as a proxy prevents the two ingress paths
// from silently acquiring different semantics.

const DEFAULT_SITE_URL = "https://voltflow.life";

function canonicalTelemetryUrl() {
  const configured = Deno.env.get("VOLTFLOW_CANONICAL_TELEMETRY_URL")?.trim();
  if (configured) return configured;

  const siteUrl = Deno.env.get("NEXT_PUBLIC_SITE_URL")?.trim() || DEFAULT_SITE_URL;
  return `${siteUrl.replace(/\/$/, "")}/api/bydmate/telemetry`;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }

  try {
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("content-length");
    const response = await fetch(canonicalTelemetryUrl(), {
      method: "POST",
      headers,
      body: request.body,
      // Deno requires this for a streamed request body.
      duplex: "half",
    });

    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  } catch (error) {
    console.error("Canonical telemetry forward failed", error);
    return Response.json({ ok: false, error: "Telemetry receiver unavailable" }, { status: 502 });
  }
});
