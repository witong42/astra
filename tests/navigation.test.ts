import { expect, test } from "bun:test";
import { externalWebUrl } from "../src/navigation";

test("external canvas links accept web URLs and reject executable protocols", () => {
  expect(externalWebUrl("https://www.youtube.com/watch?v=example")).toBe(
    "https://www.youtube.com/watch?v=example",
  );
  expect(externalWebUrl("http://localhost:3000")).toBe(
    "http://localhost:3000/",
  );
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,hello",
    "file:///etc/passwd",
    "codex://settings",
    "mailto:test@example.com",
    "https://user:password@example.com",
    "not a link",
    `https://example.com/${"x".repeat(2048)}`,
    null,
    {},
  ])
    expect(() => externalWebUrl(url)).toThrow();
});
