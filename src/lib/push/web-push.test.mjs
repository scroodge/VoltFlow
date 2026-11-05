import test from "node:test";
import assert from "node:assert/strict";
import webpush from "web-push";
import {
  isAppleWebPushEndpoint,
  getVapidPublicKey,
  sendPushToUser,
} from "./web-push.ts";

test("isAppleWebPushEndpoint identifies Apple push URLs", () => {
  assert.equal(isAppleWebPushEndpoint("https://web.push.apple.com/Q1234"), true);
  assert.equal(isAppleWebPushEndpoint("https://updates.push.apple.com/abc"), true);
  assert.equal(isAppleWebPushEndpoint("https://fcm.googleapis.com/fcm/send/123"), false);
  assert.equal(isAppleWebPushEndpoint("invalid-url"), false);
});

test("getVapidPublicKey returns NEXT_PUBLIC_VAPID_PUBLIC_KEY when present", () => {
  const orig = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "test-pub-key";
  try {
    assert.equal(getVapidPublicKey(), "test-pub-key");
  } finally {
    if (orig !== undefined) {
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = orig;
    } else {
      delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    }
  }
});

test("sendPushToUser sends notifications in parallel and cleans up 404/410 subscriptions", async () => {
  const origPub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const origPriv = process.env.VAPID_PRIVATE_KEY;
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "test-pub-key";
  process.env.VAPID_PRIVATE_KEY = "test-priv-key";

  const origSetVapidDetails = webpush.setVapidDetails;
  const origSendNotification = webpush.sendNotification;

  const sentEndpoints = [];
  webpush.setVapidDetails = () => {};
  webpush.sendNotification = async (sub, payload) => {
    sentEndpoints.push(sub.endpoint);
    if (sub.endpoint.includes("expired-410")) {
      const err = new Error("Gone");
      err.statusCode = 410;
      throw err;
    }
    if (sub.endpoint.includes("error-500")) {
      const err = new Error("Internal Server Error");
      err.statusCode = 500;
      throw err;
    }
    return { statusCode: 201 };
  };

  const rows = [
    { endpoint: "https://push.example.com/sub-1", p256dh: "k1", auth: "a1", expiration_time: null },
    { endpoint: "https://push.example.com/expired-410", p256dh: "k2", auth: "a2", expiration_time: null },
    { endpoint: "https://push.example.com/error-500", p256dh: "k3", auth: "a3", expiration_time: null },
    { endpoint: "https://push.example.com/sub-4", p256dh: "k4", auth: "a4", expiration_time: null },
  ];

  const deletedSubscriptions = [];
  const mockSupabase = {
    from: (table) => {
      assert.equal(table, "push_subscriptions");
      return {
        select: () => ({
          eq: async (field, val) => {
            assert.equal(field, "user_id");
            assert.equal(val, "usr_1");
            return { data: rows, error: null };
          },
        }),
        delete: () => {
          let userVal = null;
          let endpointVal = null;
          const chain = {
            eq: (field, val) => {
              if (field === "user_id") userVal = val;
              if (field === "endpoint") endpointVal = val;
              if (userVal && endpointVal) {
                deletedSubscriptions.push({ user_id: userVal, endpoint: endpointVal });
                return Promise.resolve({ error: null });
              }
              return chain;
            },
          };
          return chain;
        },
      };
    },
  };

  try {
    const res = await sendPushToUser(
      mockSupabase,
      "usr_1",
      { title: "Test", body: "Body", url: "/", tag: "test" },
      { endpointFilter: (ep) => !ep.includes("sub-4") }, // filter out sub-4
    );

    assert.equal(res.ok, true);
    assert.equal(res.sent, 1); // Only sub-1 succeeded
    assert.equal(sentEndpoints.length, 3); // sub-1, expired-410, error-500 targeted
    assert.deepEqual(deletedSubscriptions, [
      { user_id: "usr_1", endpoint: "https://push.example.com/expired-410" },
    ]);
  } finally {
    webpush.setVapidDetails = origSetVapidDetails;
    webpush.sendNotification = origSendNotification;

    if (origPub !== undefined) process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = origPub;
    else delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

    if (origPriv !== undefined) process.env.VAPID_PRIVATE_KEY = origPriv;
    else delete process.env.VAPID_PRIVATE_KEY;
  }
});
