/** Calls an admin API route and throws an Error with the server message on failure. */
export async function postAdminAction(
  url: string,
  init: { method: "POST" | "DELETE"; body?: unknown },
  fallbackError: string,
) {
  const hasBody = init.body !== undefined;
  const response = await fetch(url, {
    method: init.method,
    headers: hasBody ? { "content-type": "application/json" } : undefined,
    credentials: "include",
    body: hasBody ? JSON.stringify(init.body) : undefined,
  });
  const body = (await response.json()) as { ok?: boolean; error?: string };
  if (!response.ok || !body.ok) {
    throw new Error(body.error ?? fallbackError);
  }
}
