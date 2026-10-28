import assert from "node:assert/strict";
import test from "node:test";

import { mateReleaseCatalogRow } from "./mate-latest-release.ts";

const release = {
  id: "github-release-0.6.2",
  version: "0.6.2",
  version_code: 345,
  apk_url: "https://github.com/scroodge/BYDMate-own/releases/tag/v0.6.2",
  release_notes: "Debug build — VoltFlow-Mate-v0.6.2.apk (versionCode 345).",
  published_at: "2026-10-28T17:58:00Z",
  created_at: "2026-10-28T17:58:00Z",
  source: "github",
};

test("mateReleaseCatalogRow maps a GitHub release to catalog columns", () => {
  assert.deepEqual(mateReleaseCatalogRow(release), {
    version: "0.6.2",
    version_code: 345,
    apk_url: "https://github.com/scroodge/BYDMate-own/releases/tag/v0.6.2",
    release_notes: "Debug build — VoltFlow-Mate-v0.6.2.apk (versionCode 345).",
    published_at: "2026-10-28T17:58:00Z",
  });
});

test("mateReleaseCatalogRow skips a release without versionCode", () => {
  // A null code sorts below older rows (`version_code desc nulls last`).
  assert.equal(mateReleaseCatalogRow({ ...release, version_code: null }), null);
});
