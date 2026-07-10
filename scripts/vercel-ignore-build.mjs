import { execFileSync } from "node:child_process";

const NON_APP_PATH = /^(docs\/|supabase\/|screenshots\/|[^/]+\.md$)/;

function changedFiles() {
  try {
    return execFileSync("git", ["diff", "--name-only", "HEAD^", "HEAD"], {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
  } catch {
    // A first deployment or a shallow clone without a parent must build.
    return null;
  }
}

const files = changedFiles();
const shouldIgnore = files != null && files.length > 0 && files.every((file) => NON_APP_PATH.test(file));

process.exitCode = shouldIgnore ? 0 : 1;
