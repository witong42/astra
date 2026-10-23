import { z } from "zod";

export const MAX_APP_NAME_LENGTH = 32;
export const MAX_APP_NAME_WORDS = 2;
export const appNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_APP_NAME_LENGTH)
  .refine(
    (name) =>
      /[\p{L}\p{N}]/u.test(name) &&
      !/[\r\n\t\p{Cc}]/u.test(name) &&
      name.split(/\s+/).length <= MAX_APP_NAME_WORDS,
    "Use an app name with one or two words.",
  );
const TOPICS: [RegExp, string][] = [
  [/presentations?|slides?|diaporama/i, "Slide Studio"],
  [/money|argent|income/i, "Money Map"],
  [/adventure|aventure/i, "Story World"],
  [/orbit/i, "Orbit Lab"],
  [/wikip[eé]dia|wiki/i, "Personal Wiki"],
  [/chatgpt.*business/i, "Business Guide"],
  [/dashboard|tableau de bord/i, "Life Board"],
  [/calculat|calculatrice/i, "Calculator"],
  [/solar|solaire/i, "Solar System"],
  [/youtube|vid[eé]o/i, "Video Lounge"],
  [/music|musique/i, "Music Room"],
  [/game|jeu/i, "Arcade"],
  [/week|planning|planner|semaine/i, "Week Planner"],
  [/idea|id[eé]e|cool/i, "Idea Lab"],
];
const REQUEST_WORDS =
  /^(?:a|an|the|i|me|my|make|create|build|want|wanna|need|please|can|you|help|app|application|workspace|de|du|des|un|une|le|la|les|je|moi|mon|ma|faire|cr[eé]e|montre|avec|to|for|of|and|with|about)$/i;
export function shortAppName(text: string): string {
  const existing = appNameSchema.safeParse(text);
  if (existing.success) return existing.data;
  for (const [pattern, name] of TOPICS) if (pattern.test(text)) return name;
  const words = (text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [])
    .filter((word) => !REQUEST_WORDS.test(word))
    .slice(0, MAX_APP_NAME_WORDS)
    .map((word) => word[0].toLocaleUpperCase() + word.slice(1));
  const name = words.join(" ").slice(0, MAX_APP_NAME_LENGTH).trim();
  return name || "New App";
}
