import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

process.env.NEXT_PUBLIC_API_URL = "https://api.example.com";

const { ApiError, apiGet, apiPost } = await import("./api.ts");

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("apiGet makes a successful GET request", async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.example.com/status");
    assert.equal(init.method, "GET");
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await apiGet("/status");
  assert.deepEqual(result, { status: "ok" });
});

test("apiGet handles 204 No Content response", async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.example.com/empty");
    assert.equal(init.method, "GET");
    return new Response(null, { status: 204 });
  };

  const result = await apiGet("/empty");
  assert.equal(result, undefined);
});

test("apiPost sends JSON body in POST request", async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.example.com/items");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.get("Content-Type"), "application/json");
    assert.equal(init.body, JSON.stringify({ name: "test item" }));
    return new Response(JSON.stringify({ id: 123, name: "test item" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await apiPost("/items", { name: "test item" });
  assert.deepEqual(result, { id: 123, name: "test item" });
});

test("parses JSON error response with payload.message", async () => {
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ message: "Invalid payload supplied" }), {
      status: 400,
      statusText: "Bad Request",
      headers: { "Content-Type": "application/json" },
    });
  };

  await assert.rejects(
    async () => apiGet("/invalid"),
    (err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 400);
      assert.equal(err.statusText, "Bad Request");
      assert.equal(err.url, "https://api.example.com/invalid");
      assert.equal(err.message, "API request failed with 400 Bad Request: Invalid payload supplied");
      return true;
    }
  );
});

test("parses JSON error response with payload.error string", async () => {
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ error: "Unauthorized access" }), {
      status: 401,
      statusText: "Unauthorized",
      headers: { "Content-Type": "application/json" },
    });
  };

  await assert.rejects(
    async () => apiGet("/protected"),
    (err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 401);
      assert.equal(err.message, "API request failed with 401 Unauthorized: Unauthorized access");
      return true;
    }
  );
});

test("parses JSON error response with generic payload object", async () => {
  globalThis.fetch = async () => {
    return new Response(JSON.stringify({ code: 500, details: "Internal error" }), {
      status: 500,
      statusText: "Internal Server Error",
      headers: { "Content-Type": "application/json" },
    });
  };

  await assert.rejects(
    async () => apiGet("/error"),
    (err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 500);
      assert.equal(err.message, 'API request failed with 500 Internal Server Error: {"code":500,"details":"Internal error"}');
      return true;
    }
  );
});

test("parses text error response when Content-Type is not JSON", async () => {
  globalThis.fetch = async () => {
    return new Response("Service Unavailable Text", {
      status: 503,
      statusText: "Service Unavailable",
      headers: { "Content-Type": "text/plain" },
    });
  };

  await assert.rejects(
    async () => apiGet("/down"),
    (err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 503);
      assert.equal(err.message, "API request failed with 503 Service Unavailable: Service Unavailable Text");
      return true;
    }
  );
});

test("handles response whose .json() throws an error (JSON parse failure in application/json)", async () => {
  globalThis.fetch = async () => {
    const response = new Response("", {
      status: 500,
      statusText: "Internal Server Error",
      headers: { "Content-Type": "application/json" },
    });
    response.json = async () => {
      throw new SyntaxError("Unexpected end of JSON input");
    };
    return response;
  };

  await assert.rejects(
    async () => apiGet("/broken-json"),
    (err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 500);
      assert.equal(err.message, "API request failed with 500 Internal Server Error");
      return true;
    }
  );
});

test("handles response whose .text() throws an error", async () => {
  globalThis.fetch = async () => {
    const response = new Response(null, {
      status: 500,
      statusText: "Internal Server Error",
      headers: { "Content-Type": "text/plain" },
    });
    response.text = async () => {
      throw new Error("Failed to read text body");
    };
    return response;
  };

  await assert.rejects(
    async () => apiGet("/broken-text"),
    (err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 500);
      assert.equal(err.message, "API request failed with 500 Internal Server Error");
      return true;
    }
  );
});
