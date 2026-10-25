import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { astraConfig, codexEnvironment } from "../src/config";

test.skipIf(process.platform !== "darwin")(
  "Astra configuration prefers its namespace and preserves existing profiles",
  () => {
    const homeDirectory = mkdtempSync(join(tmpdir(), "astra-config-test-"));
    try {
      const current = join(homeDirectory, "Library/Application Support/Astra");
      const legacy = join(homeDirectory, "Library/Application Support/CodexOS");
      expect(astraConfig({}, homeDirectory).dataDirectory).toBe(current);
      mkdirSync(legacy, { recursive: true });
      const state = join(legacy, "workspace.json");
      const saved = '{"apps":["keep-me"],"journal":["keep-history"]}';
      writeFileSync(state, saved);
      expect(astraConfig({}, homeDirectory).dataDirectory).toBe(legacy);
      expect(readFileSync(state, "utf8")).toBe(saved);
      mkdirSync(current);
      expect(astraConfig({}, homeDirectory).dataDirectory).toBe(legacy);
      writeFileSync(
        join(current, "workspace.json"),
        '{"apps":["new-profile"]}',
      );
      expect(astraConfig({}, homeDirectory).dataDirectory).toBe(current);
      expect(readFileSync(state, "utf8")).toBe(saved);
      expect(
        astraConfig({ ASTRA_DATA_DIR: "/explicit/profile" }, homeDirectory)
          .dataDirectory,
      ).toBe("/explicit/profile");
      expect(
        astraConfig({ CODEXOS_DATA_DIR: "/saved/profile" }, homeDirectory)
          .dataDirectory,
      ).toBe("/saved/profile");
      const environment = {
        ASTRA_DATA_DIR: "/new/profile",
        CODEXOS_DATA_DIR: "/old/profile",
        ASTRA_CODEX_PATH: "/new/codex",
        CODEXOS_CODEX_PATH: "/old/codex",
        ASTRA_TEST_HIDDEN: "1",
        CODEXOS_TEST_HIDDEN: "0",
      };
      expect(astraConfig(environment, homeDirectory)).toEqual({
        dataDirectory: "/new/profile",
        codexPath: "/new/codex",
        testHidden: true,
      });
      expect(
        astraConfig({ CODEXOS_CODEX_PATH: "/saved/codex" }, homeDirectory)
          .codexPath,
      ).toBe("/saved/codex");
      expect(
        astraConfig({ ASTRA_TEST_HIDDEN: "1" }, homeDirectory).testHidden,
      ).toBe(false);
      expect(
        astraConfig(
          { CODEXOS_DATA_DIR: "/saved/profile", CODEXOS_TEST_HIDDEN: "1" },
          homeDirectory,
        ).testHidden,
      ).toBe(true);
    } finally {
      rmSync(homeDirectory, { recursive: true });
    }
  },
);

test("Windows Codex startup preserves PATH entries and an explicit Codex home", () => {
  const env = codexEnvironment(
    {
      Path: "C:\\Windows\\System32;C:\\Tools With Spaces",
      CODEX_HOME: "D:\\Codex",
    },
    "C:\\Users\\Voice Test",
    "win32",
  );
  expect(env.PATH.split(";")).toEqual([
    "C:\\Users\\Voice Test\\.local\\bin",
    "C:\\Users\\Voice Test\\.bun\\bin",
    "C:\\Windows\\System32",
    "C:\\Tools With Spaces",
  ]);
  expect(env.CODEX_HOME).toBe("D:\\Codex");
});

test("Windows stores Astra in roaming app data and keeps explicit profiles", () => {
  const home = "C:\\Users\\Voice Test";
  const roaming = "D:\\Profile Data\\Roaming";
  expect(astraConfig({ APPDATA: roaming }, home, "win32").dataDirectory).toBe(
    `${roaming}\\Astra`,
  );
  expect(astraConfig({}, home, "win32").dataDirectory).toBe(
    `${home}\\AppData\\Roaming\\Astra`,
  );
  expect(
    astraConfig({ ASTRA_DATA_DIR: "D:\\Astra Test" }, home, "win32")
      .dataDirectory,
  ).toBe("D:\\Astra Test");
});

test("Linux stores profiles in XDG config and preserves explicit overrides", () => {
  const home = "/home/voice-test";
  expect(astraConfig({}, home, "linux").dataDirectory).toBe(
    `${home}/.config/Astra`,
  );
  expect(
    astraConfig({ XDG_CONFIG_HOME: "/profiles/config" }, home, "linux")
      .dataDirectory,
  ).toBe("/profiles/config/Astra");
  for (const value of ["", "relative/config"])
    expect(
      astraConfig({ XDG_CONFIG_HOME: value }, home, "linux").dataDirectory,
    ).toBe(`${home}/.config/Astra`);
  expect(
    astraConfig(
      { XDG_CONFIG_HOME: "/profiles/config", ASTRA_DATA_DIR: "/test/astra" },
      home,
      "linux",
    ).dataDirectory,
  ).toBe("/test/astra");
});

test.skipIf(process.platform === "win32")(
  "Linux keeps a legacy profile until a saved Astra profile exists",
  () => {
    const home = mkdtempSync(join(tmpdir(), "astra-linux-config-"));
    try {
      const config = join(home, ".config");
      const legacy = join(config, "CodexOS");
      const current = join(config, "Astra");
      mkdirSync(legacy, { recursive: true });
      const saved = '{"apps":["preserve-this-app"]}';
      writeFileSync(join(legacy, "workspace.json"), saved);
      expect(astraConfig({}, home, "linux").dataDirectory).toBe(legacy);
      mkdirSync(current);
      expect(astraConfig({}, home, "linux").dataDirectory).toBe(legacy);
      writeFileSync(join(current, "workspace.json"), "{}");
      expect(astraConfig({}, home, "linux").dataDirectory).toBe(current);
      expect(readFileSync(join(legacy, "workspace.json"), "utf8")).toBe(saved);
    } finally {
      rmSync(home, { recursive: true });
    }
  },
);

test("Linux Codex startup includes user tools and Linux system paths", () => {
  const env = codexEnvironment(
    { PATH: "/custom/bin", CODEX_HOME: "/profiles/codex" },
    "/home/voice-test",
    "linux",
  );
  expect(env.PATH.split(":")).toEqual([
    "/home/voice-test/.local/bin",
    "/home/voice-test/.bun/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/custom/bin",
  ]);
  expect(env.CODEX_HOME).toBe("/profiles/codex");
});
