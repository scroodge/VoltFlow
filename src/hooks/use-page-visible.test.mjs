import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  getServerSnapshot,
  getSnapshot,
  subscribe,
  usePageVisible,
} from "./use-page-visible.ts";

test("getServerSnapshot returns true during server-side rendering (SSR)", () => {
  assert.equal(getServerSnapshot(), true);
});

test("getSnapshot returns true when document.visibilityState is 'visible'", () => {
  const originalDocument = global.document;
  global.document = {
    visibilityState: "visible",
  };

  try {
    assert.equal(getSnapshot(), true);
  } finally {
    global.document = originalDocument;
  }
});

test("getSnapshot returns false when document.visibilityState is 'hidden' or not 'visible'", () => {
  const originalDocument = global.document;
  global.document = {
    visibilityState: "hidden",
  };

  try {
    assert.equal(getSnapshot(), false);
  } finally {
    global.document = originalDocument;
  }
});

test("subscribe adds and removes the 'visibilitychange' event listener on document", () => {
  const originalDocument = global.document;
  const listeners = new Set();

  global.document = {
    addEventListener(type, listener) {
      if (type === "visibilitychange") {
        listeners.add(listener);
      }
    },
    removeEventListener(type, listener) {
      if (type === "visibilitychange") {
        listeners.delete(listener);
      }
    },
  };

  try {
    let invoked = false;
    const storeCallback = () => {
      invoked = true;
    };

    const unsubscribe = subscribe(storeCallback);
    assert.equal(listeners.has(storeCallback), true);

    for (const listener of listeners) {
      listener();
    }
    assert.equal(invoked, true);

    unsubscribe();
    assert.equal(listeners.has(storeCallback), false);
  } finally {
    global.document = originalDocument;
  }
});

test("usePageVisible component integration with SSR renderer", () => {
  const originalDocument = global.document;
  delete global.document;

  try {
    function TestComponent() {
      const isVisible = usePageVisible();
      return React.createElement("span", null, String(isVisible));
    }

    const html = renderToStaticMarkup(React.createElement(TestComponent));
    assert.equal(html, "<span>true</span>");
  } finally {
    global.document = originalDocument;
  }
});
