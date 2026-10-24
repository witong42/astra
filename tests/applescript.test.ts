import { expect, test } from "bun:test";
import { appleScriptRequestSchema, runAppleScript } from "../src/applescript";

test("native requests reject empty scripts, non-string args, oversized scripts and extra fields", () => {
  for (const request of [
    { script: " " },
    { script: "return 1", args: [1] },
    { script: "x".repeat(65_537) },
    { script: "return 1", executable: "sh" },
  ])
    expect(appleScriptRequestSchema.safeParse(request).success).toBe(false);
});

test.skipIf(process.platform !== "darwin")(
  "executes AppleScript and preserves arguments as data",
  async () => {
    const argument = 'quoted " text; $(echo nope)\nreturn 999';
    expect(
      await runAppleScript({
        script: "on run argv\nreturn item 1 of argv\nend run",
        args: [argument],
      }),
    ).toBe(argument);
    expect(await runAppleScript({ script: "return 6 * 7" })).toBe("42");
    expect(
      await runAppleScript({
        script: "on run argv\nreturn item 1 of argv\nend run",
        args: ["-e"],
      }),
    ).toBe("-e");
  },
);

test.skipIf(process.platform !== "darwin")(
  "surfaces script errors and enforces output bounds",
  async () => {
    await expect(
      runAppleScript({ script: 'error "Native action failed" number 1234' }),
    ).rejects.toThrow("Native action failed");
    await expect(
      runAppleScript({
        script:
          'return do shell script "/usr/bin/yes x | /usr/bin/head -c 100000"',
      }),
    ).rejects.toThrow();
  },
);
