export const WORDS_PER_MINUTE = 200;

/** Reading time in whole minutes, derived from word_count (no AI). Null when the count is unknown. */
export function readingMinutes(wordCount: number | null | undefined): number | null {
  if (!wordCount || wordCount <= 0) return null;
  return Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE));
}
