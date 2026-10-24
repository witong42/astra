import { expect, test } from "bun:test";
import { copy, siteLanguage } from "../website/copy";

test("the public site's language choice accepts French and falls back to English", () => {
  expect(siteLanguage("fr")).toBe("fr");
  for (const input of ["en", null, "de", "FR", "<script>"])
    expect(siteLanguage(input)).toBe("en");
});

test("French covers every public-site message, including accessible control names", async () => {
  expect(Object.keys(copy.fr).sort()).toEqual(Object.keys(copy.en).sort());
  const html = await Bun.file(
    new URL("../website/index.html", import.meta.url),
  ).text();
  const messages = [...html.matchAll(/data-i18n="([^"]+)"/g)].map(
    (match) => match[1],
  );
  for (const key of messages) {
    expect(copy.en[key as keyof typeof copy.en]).toBeTruthy();
    expect(copy.fr[key as keyof typeof copy.fr]).toBeTruthy();
  }
  expect(copy.fr.copyLabel).toContain("Copier");
  expect(copy.fr.videoLabel).toContain("anglais");
});

test("the pitch uses English demonstration content and names Codex without unsupported autonomy claims", async () => {
  const narration = (await Bun.file(
    new URL("../website/media/narration.json", import.meta.url),
  ).json()) as { text: string }[];
  expect(narration.map((line) => line.text).join(" ")).toContain(
    "powered by Codex",
  );
  for (const name of ["project-before", "project", "travel", "quiz"]) {
    const demo = await Bun.file(
      new URL(`../website/media/demos/${name}.json`, import.meta.url),
    ).json();
    const visible = demo.html
      .replace(/<style[\s\S]*?<\/style>/g, "")
      .replace(/<script[\s\S]*?<\/script>/g, "")
      .replace(/<[^>]*>/g, " ");
    expect(visible).not.toMatch(
      /Un projet|Un départ|DÉMO|DONNÉES FICTIVES|prochaines étapes/,
    );
    expect(visible).toContain("SAMPLE DATA");
  }
});
