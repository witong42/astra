import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SPEECH_TEST_TIMEOUT_MS = 30_000;
const SWIFT_BUILD_TIMEOUT_MS = 90_000;
const NATIVE_TEST_TIMEOUT_MS = 180_000;
test.skipIf(process.platform !== "darwin")(
  "native speech isolates a nine-channel microphone and transcribes French and English concurrently",
  () => {
    const directory = mkdtempSync(join(tmpdir(), "astra-speech-test-"));
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
          "native/SpeechRecognition.swift",
          "native/VoiceTests.swift",
          "-o",
          executable,
        ],
        { timeout: SWIFT_BUILD_TIMEOUT_MS },
      );
      for (const [language, voice, sentence, expected] of [
        ["en", "Daniel", "Astra, open the calculator.", "calculator"],
        ["fr", "Jacques", "Astra, ouvre la calculatrice.", "calculatrice"],
        ["en", "Daniel", "Home.", "home"],
      ]) {
        const audio = join(directory, `${language}.aiff`);
        execFileSync("/usr/bin/say", [
          "-v",
          voice,
          "-r",
          "150",
          "-o",
          audio,
          sentence,
        ]);
        const output = execFileSync(executable, [audio, language, expected], {
          encoding: "utf8",
          timeout: SPEECH_TEST_TIMEOUT_MS,
        });
        expect(output).toContain("MONO_CHANNEL_VERIFIED");
        expect(output).toContain("BILINGUAL_REPLAY_VERIFIED");
        expect(output).toContain("HOME_SHORTCUT_VERIFIED");
        expect(output).toContain("HOME_CONVERSATION_VERIFIED");
        console.log(output.trim());
      }
    } finally {
      rmSync(directory, { recursive: true });
    }
  },
  NATIVE_TEST_TIMEOUT_MS,
);
