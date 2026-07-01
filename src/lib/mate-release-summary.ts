const MAX_SUMMARY_CHARS = 220;

function stripMarkdownNoise(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\r\n/g, "\n")
    .replace(/\n{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g);
  if (!matches) return text ? [text] : [];
  return matches.map((part) => part.trim()).filter(Boolean);
}

/**
 * Returns the first 1–2 readable sentences from GitHub release notes for compact UI.
 */
export function summarizeReleaseNotes(
  notes: string | null | undefined,
  maxSentences = 2,
): string | null {
  if (!notes?.trim()) return null;

  const cleaned = stripMarkdownNoise(notes);
  if (!cleaned) return null;

  const sentences = splitSentences(cleaned);
  const summary = sentences.slice(0, maxSentences).join(" ").trim();
  if (!summary) return null;

  if (summary.length <= MAX_SUMMARY_CHARS) return summary;
  return `${summary.slice(0, MAX_SUMMARY_CHARS - 1).trimEnd()}…`;
}

export const MATE_GITHUB_RELEASES_LATEST_URL =
  "https://github.com/scroodge/BYDMate-own/releases/latest";

export const DIPLUS_APK_URL =
  "https://github.com/scroodge/VoltFlow/blob/main/install/Di%2B_1.3.6_26.01.2025.apk";
