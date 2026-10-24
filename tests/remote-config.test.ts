import { expect, test } from "bun:test";
import { remoteConfigSchema } from "../src/remote-config";

test("remote access accepts only one exact HTTPS origin and a bounded local port", () => {
  const valid = {
    origin: "https://astra-test.chatgpt.site",
    user: "owner@example.com",
  };
  expect(remoteConfigSchema.parse(valid).port).toBe(4319);
  for (const origin of [
    "*",
    "http://astra-test.chatgpt.site",
    "https://astra-test.chatgpt.site/",
    "https://user:secret@example.com",
    "https://example.com/path",
  ])
    expect(remoteConfigSchema.safeParse({ ...valid, origin }).success).toBe(
      false,
    );
  for (const port of [0, 80, 65536, 4319.5])
    expect(remoteConfigSchema.safeParse({ ...valid, port }).success).toBe(
      false,
    );
  expect(
    remoteConfigSchema.safeParse({ ...valid, token: "unexpected" }).success,
  ).toBe(false);
});
