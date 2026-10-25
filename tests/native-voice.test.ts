import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NATIVE_BUILD_TIMEOUT_MS = 90_000;
test.skipIf(process.platform !== "darwin")(
  "native capture isolates microphone channels and retains echo processing with minimum ducking",
  () => {
    const directory = mkdtempSync(join(tmpdir(), "astra-capture-test-"));
    try {
      const executable = join(directory, "voice-test");
      execFileSync(
        "xcrun",
        [
          "swiftc",
          "-parse-as-library",
          "-swift-version",
          "5",
          "-D",
          "ASTRA_SPEECH_TEST",
          "native/Voice.swift",
          "native/VoiceTests.swift",
          "-o",
          executable,
        ],
        { timeout: NATIVE_BUILD_TIMEOUT_MS },
      );
      const output = execFileSync(executable, [], {
        encoding: "utf8",
        timeout: NATIVE_BUILD_TIMEOUT_MS,
      });
      expect(output).toContain("MONO_CHANNEL_VERIFIED");
      expect(output).toContain("VOICE_DUCKING_VERIFIED");
    } finally {
      rmSync(directory, { recursive: true });
    }
  },
  NATIVE_BUILD_TIMEOUT_MS,
);
