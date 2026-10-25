import { expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Astra } from "../src/Astra";
import { Composer } from "../src/Chat";
import { Journal } from "../src/JournalView";
import { LocaleProvider } from "../src/LocaleProvider";
import {
  LANGUAGE_STORAGE_KEY,
  readLanguage,
  writeLanguage,
} from "../src/locale";
import { newWorkspace } from "../src/storage";
import type { Snapshot } from "../src/types";
import { INITIAL_VOICE } from "../src/voice";
import { WorkspaceMenu } from "../src/WorkspaceMenu";
import { WebAudio } from "../src/web-audio";
import { WebBridge } from "../src/web-bridge";

test("the interface preference defaults to French, validates stored values and only changes its own local key", () => {
  const values = new Map([["workspace", "Mon contenu"]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  expect(readLanguage(storage)).toBe("fr");
  writeLanguage("en", storage);
  expect(readLanguage(storage)).toBe("en");
  expect(values.get("workspace")).toBe("Mon contenu");
  values.set(LANGUAGE_STORAGE_KEY, "de");
  expect(readLanguage(storage)).toBe("fr");
  writeLanguage("fr", storage);
  expect(readLanguage(storage)).toBe("fr");
});

test("unavailable preference storage reports the failure rather than pretending to save", () => {
  const warning = spyOn(console, "warn").mockImplementation(() => {});
  const storage = {
    getItem: () => {
      throw new DOMException("Storage blocked", "SecurityError");
    },
    setItem: () => {
      throw new DOMException("Storage blocked", "SecurityError");
    },
  };
  try {
    expect(readLanguage(storage)).toBe("fr");
    expect(warning).toHaveBeenCalledTimes(1);
    expect(() => writeLanguage("en", storage)).toThrow("language");
  } finally {
    warning.mockRestore();
  }
});

test("phone dialogs and audio recovery use the phone's preference without sending an action or starting voice", async () => {
  const previousWindow = globalThis.window;
  const previousSource = globalThis.EventSource;
  const values = new Map<string, string>();
  const dialogs: string[] = [];
  globalThis.window = {
    localStorage: { getItem: (key: string) => values.get(key) ?? null },
    confirm: (message: string) => {
      dialogs.push(message);
      return false;
    },
    prompt: (message: string) => {
      dialogs.push(message);
      return null;
    },
    addEventListener() {},
  } as unknown as typeof window;
  globalThis.EventSource = class {
    close() {}
  } as unknown as typeof EventSource;
  try {
    const remote = new WebBridge("https://invalid.example", () => {});
    const audio = new WebAudio(
      async () => {},
      () => {},
      () => {},
    );
    for (const language of ["fr", "en"]) {
      values.set(LANGUAGE_STORAGE_KEY, language);
      expect(await remote.bridge.deleteWorkspace("unused")).toBe(false);
      await remote.bridge.chooseFolder();
      expect(dialogs.at(-2)).toContain(
        language === "fr" ? "Supprimer définitivement" : "Permanently delete",
      );
      expect(dialogs.at(-1)).toContain(
        language === "fr" ? "Chemin absolu" : "Absolute path",
      );
      await expect(remote.bridge.startVoice()).rejects.toThrow(
        language === "fr" ? "Reconnecte le téléphone" : "Reconnect your phone",
      );
      await expect(audio.resumeOutput()).rejects.toThrow(
        language === "fr" ? "Active la voix" : "Enable voice",
      );
    }
  } finally {
    globalThis.window = previousWindow;
    globalThis.EventSource = previousSource;
  }
});

test("interface labels and dates follow the selected locale while app names, drafts, history and speech keep their language", () => {
  const previous = globalThis.window;
  globalThis.window = { astra: {} } as typeof window;
  const app = newWorkspace("/tmp");
  app.name = "Mon app française";
  const snapshot: Snapshot = {
    version: 1,
    activeId: app.id,
    model: "test",
    reasoningEffort: "low",
    serviceTier: "default",
    workspaces: [app],
    sessions: {},
    status: "ready",
    activity: "Ready",
    account: "",
    backendVersion: "test",
    models: [],
    approval: null,
    error: null,
    metrics: null,
    journal: [
      {
        id: "original",
        kind: "user",
        source: "voice",
        at: Date.UTC(2026, 0, 4, 12),
        text: "Bonjour, garde cette phrase.",
      },
    ],
  };
  const noop = async () => {};
  try {
    for (const language of ["fr", "en"] as const) {
      const html = renderToStaticMarkup(
        <LocaleProvider initialLanguage={language}>
          <WorkspaceMenu
            workspace={app}
            busy={false}
            onRename={noop}
            onDelete={noop}
          />
          <Journal
            snapshot={snapshot}
            onClose={() => {}}
            onOpen={() => {}}
            onError={() => {}}
          />
          <Composer
            snapshot={snapshot}
            workspaceId={app.id}
            draft="Texte saisi en français"
            onDraftChange={() => {}}
            onSend={noop}
            onError={() => {}}
          />
          <Astra
            compact
            voice={{ ...INITIAL_VOICE, language: "fr", status: "listening" }}
          />
        </LocaleProvider>,
      );
      expect(html).toContain("Mon app française");
      expect(html).toContain("Bonjour, garde cette phrase.");
      expect(html).toContain("Texte saisi en français");
      expect(html).toContain(language === "fr" ? "Renommer" : "Rename");
      expect(html).toContain(language === "fr" ? "janvier" : "January");
      expect(html).toContain(
        language === "fr"
          ? 'aria-description="À ton écoute"'
          : 'aria-description="Listening"',
      );
      expect(html).toContain(language === "fr" ? "Envoyer" : "Send");
    }
  } finally {
    globalThis.window = previous;
  }
});
