import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { clearPrivateBrowserData } from "./client.ts";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalCaches = Object.getOwnPropertyDescriptor(globalThis, "caches");
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

function restoreDescriptor(key, descriptor) {
  if (descriptor) {
    Object.defineProperty(globalThis, key, descriptor);
  } else {
    delete globalThis[key];
  }
}

afterEach(() => {
  restoreDescriptor("window", originalWindow);
  restoreDescriptor("caches", originalCaches);
  restoreDescriptor("navigator", originalNavigator);
});

function setupGlobals({ windowVal, cachesVal, navigatorVal }) {
  if (windowVal !== undefined) {
    Object.defineProperty(globalThis, "window", {
      value: windowVal,
      writable: true,
      configurable: true,
    });
  } else {
    delete globalThis.window;
  }

  if (cachesVal !== undefined) {
    Object.defineProperty(globalThis, "caches", {
      value: cachesVal,
      writable: true,
      configurable: true,
    });
  } else {
    delete globalThis.caches;
  }

  if (navigatorVal !== undefined) {
    Object.defineProperty(globalThis, "navigator", {
      value: navigatorVal,
      writable: true,
      configurable: true,
    });
  } else {
    delete globalThis.navigator;
  }
}

test("clearPrivateBrowserData clears local storage, app-shell caches, and notifies service workers", async () => {
  const removedKeys = [];
  const deletedCaches = [];
  const postedMessages = [];

  const mockLocalStorage = {
    removeItem: (key) => {
      removedKeys.push(key);
    },
  };

  const mockCaches = {
    keys: async () => [
      "voltflow-app-shell-v1",
      "voltflow-app-shell-v2",
      "user-data-cache",
    ],
    delete: async (key) => {
      deletedCaches.push(key);
      return true;
    },
  };

  const createMockWorker = (name) => ({
    name,
    postMessage: (msg) => {
      postedMessages.push({ worker: name, msg });
    },
  });

  const activeWorker = createMockWorker("active");
  const waitingWorker = createMockWorker("waiting");
  const installingWorker = createMockWorker("installing");

  const mockServiceWorker = {
    getRegistration: async () => ({
      active: activeWorker,
      waiting: waitingWorker,
      installing: installingWorker,
    }),
  };

  setupGlobals({
    windowVal: {
      localStorage: mockLocalStorage,
      caches: mockCaches,
    },
    cachesVal: mockCaches,
    navigatorVal: {
      serviceWorker: mockServiceWorker,
    },
  });

  await clearPrivateBrowserData();

  assert.deepEqual(removedKeys, [
    "voltflow:last_gps",
    "ev-charge-preferences",
    "mate-update-dismiss",
    "voltflow.telegram.generation",
    "voltflow:kb_viewed",
    "voltflow:last_active_touch",
  ]);

  assert.deepEqual(deletedCaches, [
    "voltflow-app-shell-v1",
    "voltflow-app-shell-v2",
  ]);

  assert.deepEqual(postedMessages, [
    { worker: "active", msg: { type: "voltflow:clear-private-cache" } },
    { worker: "waiting", msg: { type: "voltflow:clear-private-cache" } },
    { worker: "installing", msg: { type: "voltflow:clear-private-cache" } },
  ]);
});

test("clearPrivateBrowserData continues cache and worker cleanup if localStorage throws", async () => {
  const deletedCaches = [];
  const postedMessages = [];

  const mockLocalStorage = {
    removeItem: () => {
      throw new Error("QuotaExceededError or private browsing restriction");
    },
  };

  const mockCaches = {
    keys: async () => ["voltflow-app-shell-test"],
    delete: async (key) => {
      deletedCaches.push(key);
      return true;
    },
  };

  const activeWorker = {
    postMessage: (msg) => {
      postedMessages.push(msg);
    },
  };

  setupGlobals({
    windowVal: {
      localStorage: mockLocalStorage,
      caches: mockCaches,
    },
    cachesVal: mockCaches,
    navigatorVal: {
      serviceWorker: {
        getRegistration: async () => ({
          active: activeWorker,
        }),
      },
    },
  });

  await assert.doesNotReject(async () => {
    await clearPrivateBrowserData();
  });

  assert.deepEqual(deletedCaches, ["voltflow-app-shell-test"]);
  assert.deepEqual(postedMessages, [{ type: "voltflow:clear-private-cache" }]);
});

test("clearPrivateBrowserData exits early if caches is not in window", async () => {
  const removedKeys = [];
  const mockLocalStorage = {
    removeItem: (key) => {
      removedKeys.push(key);
    },
  };

  setupGlobals({
    windowVal: {
      localStorage: mockLocalStorage,
    },
    cachesVal: undefined,
    navigatorVal: {},
  });

  await clearPrivateBrowserData();

  assert.equal(removedKeys.length, 6);
});

test("clearPrivateBrowserData continues service worker cleanup if caches throws an error", async () => {
  const postedMessages = [];

  const mockLocalStorage = {
    removeItem: () => {},
  };

  const mockCaches = {
    keys: async () => {
      throw new Error("Cache API error");
    },
  };

  const activeWorker = {
    postMessage: (msg) => {
      postedMessages.push(msg);
    },
  };

  setupGlobals({
    windowVal: {
      localStorage: mockLocalStorage,
      caches: mockCaches,
    },
    cachesVal: mockCaches,
    navigatorVal: {
      serviceWorker: {
        getRegistration: async () => ({
          active: activeWorker,
        }),
      },
    },
  });

  await assert.doesNotReject(async () => {
    await clearPrivateBrowserData();
  });

  assert.deepEqual(postedMessages, [{ type: "voltflow:clear-private-cache" }]);
});

test("clearPrivateBrowserData gracefully handles serviceWorker throwing or being undefined", async () => {
  const mockLocalStorage = {
    removeItem: () => {},
  };

  const mockCaches = {
    keys: async () => [],
  };

  // Case 1: navigator.serviceWorker.getRegistration throws
  setupGlobals({
    windowVal: {
      localStorage: mockLocalStorage,
      caches: mockCaches,
    },
    cachesVal: mockCaches,
    navigatorVal: {
      serviceWorker: {
        getRegistration: async () => {
          throw new Error("ServiceWorker registration failed");
        },
      },
    },
  });

  await assert.doesNotReject(async () => {
    await clearPrivateBrowserData();
  });

  // Case 2: navigator.serviceWorker is undefined
  setupGlobals({
    windowVal: {
      localStorage: mockLocalStorage,
      caches: mockCaches,
    },
    cachesVal: mockCaches,
    navigatorVal: {},
  });

  await assert.doesNotReject(async () => {
    await clearPrivateBrowserData();
  });
});
