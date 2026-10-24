import { expect, test } from "bun:test";
import type { RpcMessage } from "../src/rpc";
import { newWorkspace } from "../src/storage";
import type { Snapshot } from "../src/types";
import { type SpeechEvent, VoiceSession } from "../src/voice";

function fixture(
  options: {
    mediaError?: Error;
    wakeError?: Error;
    shortcutError?: Error;
    homeError?: Error;
    autoSdp?: boolean;
  } = {},
) {
  const app = newWorkspace("/tmp");
  const assistant = newWorkspace("/tmp");
  const snapshot: Snapshot = {
    version: 1,
    activeId: app.id,
    model: "test",
    reasoningEffort: "low",
    serviceTier: "default",
    workspaces: [app],
    assistant,
    sessions: {},
    status: "ready",
    activity: "Ready",
    account: "",
    backendVersion: "test",
    models: [],
    approval: null,
    error: null,
    metrics: null,
  };
  let realtime: (message: RpcMessage) => void = () => {};
  let wakeEvent: (event: SpeechEvent) => void = () => {};
  let shortcutEvent: (event: SpeechEvent) => void = () => {};
  let mediaEvent: (event: SpeechEvent) => void = () => {};
  const calls: string[] = [];
  const muted: boolean[] = [];
  const sent: string[] = [];
  let mediaStops = 0;
  let wakeStarts = 0;
  let wakeStops = 0;
  let homeRequests = 0;
  let shortcutStarts = 0;
  let shortcutStops = 0;
  const voice = new VoiceSession(
    {
      ensureAssistantWorkspace: () => assistant.id,
      subscribeRealtime: (listener) => {
        realtime = listener;
        return () => {};
      },
      startRealtimeVoice: async (offer) => {
        calls.push(offer);
        if (options.autoSdp !== false)
          realtime({
            method: "thread/realtime/sdp",
            params: { sdp: "answer" },
          });
      },
      stopRealtimeVoice: async () => {},
      speakRealtime: async (text) => {
        calls.push(`say:${text}`);
      },
      interrupt: async (id) => {
        if (id) calls.push(`interrupt:${id}`);
      },
      snapshot: () => snapshot,
      send: async (text) => {
        sent.push(text);
      },
    },
    (listener) => {
      let homeOnly = false;
      return {
        start: async (standby, shortcutsOnly) => {
          homeOnly = Boolean(shortcutsOnly);
          if (homeOnly) {
            shortcutEvent = listener;
            if (options.shortcutError) throw options.shortcutError;
            shortcutStarts++;
            return;
          }
          wakeEvent = listener;
          if (options.wakeError) throw options.wakeError;
          expect(standby).toBe(true);
          wakeStarts++;
        },
        stop: () => {
          if (homeOnly) shortcutStops++;
          else wakeStops++;
        },
      };
    },
    (listener) => {
      mediaEvent = listener;
      return {
        offer: async () => {
          if (options.mediaError) throw options.mediaError;
          return "offer";
        },
        answer: async (sdp) => {
          calls.push(sdp);
        },
        muteOutput: async (value) => {
          muted.push(value);
        },
        stop: () => {
          mediaStops++;
        },
      };
    },
    () => {},
    async () => {
      if (options.homeError) throw options.homeError;
      homeRequests++;
    },
  );
  return {
    voice,
    calls,
    snapshot,
    assistant,
    muted,
    sent,
    realtime: (method: string, params: Record<string, unknown> = {}) =>
      realtime({ method: `thread/realtime/${method}`, params }),
    wake: (event: SpeechEvent) => wakeEvent(event),
    shortcut: (event: SpeechEvent) => shortcutEvent(event),
    media: (event: SpeechEvent) => mediaEvent(event),
    mediaStops: () => mediaStops,
    wakeStarts: () => wakeStarts,
    wakeStops: () => wakeStops,
    homeRequests: () => homeRequests,
    shortcutStarts: () => shortcutStarts,
    shortcutStops: () => shortcutStops,
  };
}

async function tick() {
  await Bun.sleep(0);
}

test("the galaxy starts GPT-Live and accepts SDP before the request acknowledgement", async () => {
  const f = fixture();
  try {
    await f.voice.start();
    expect(f.calls).toEqual(["offer", "answer"]);
    expect(f.voice.snapshot().status).toBe("listening");
    expect(f.wakeStarts()).toBe(0);
  } finally {
    f.voice.stop();
  }
});

test("the galaxy waits for the SDP notification after the request acknowledgement", async () => {
  const f = fixture({ autoSdp: false });
  const starting = f.voice.start();
  await tick();
  expect(f.voice.snapshot().status).toBe("starting");
  f.realtime("started");
  expect(f.calls).toEqual(["offer"]);
  f.realtime("sdp", { sdp: "answer" });
  await starting;
  expect(f.voice.snapshot().status).toBe("listening");
  f.voice.stop();
});

test("saying Astra starts the same live call while ambient local transcripts do not", async () => {
  const f = fixture();
  await f.voice.start(true);
  expect(f.voice.snapshot().status).toBe("standby");
  f.wake({ method: "voice/final", text: "ambient speech" });
  expect(f.calls).toEqual([]);
  f.wake({ method: "voice/wake" });
  f.wake({ method: "voice/final", text: "" });
  await tick();
  expect(f.calls).toEqual(["offer", "answer", "say:Oui, je t’écoute."]);
  expect(f.voice.snapshot().status).toBe("listening");
  expect(f.wakeStops()).toBe(1);
  f.voice.stop();
});

test("a command spoken with the wake word reaches the existing Home agent once", async () => {
  const f = fixture({ autoSdp: false });
  await f.voice.start(true);
  f.wake({ method: "voice/wake" });
  f.wake({
    method: "voice/final",
    text: "Astra, ouvre la calculatrice",
    language: "fr",
  });
  await tick();
  f.realtime("sdp", { sdp: "answer" });
  await tick();
  expect(f.sent).toEqual(["ouvre la calculatrice"]);
  f.voice.stop();
});

test("wake recording keeps the whole command even when GPT-Live connects first", async () => {
  const f = fixture();
  await f.voice.start(true);
  f.wake({ method: "voice/wake" });
  await tick();
  expect(f.voice.snapshot().status).toBe("starting");
  expect(f.wakeStops()).toBe(0);
  f.wake({ method: "voice/final", text: "Astra, create a timer" });
  await tick();
  expect(f.sent).toEqual(["create a timer"]);
  expect(f.wakeStops()).toBe(1);
  f.voice.stop();
});

test("live transcripts mirror French and English without sending duplicate agent turns", async () => {
  const f = fixture();
  await f.voice.start();
  f.realtime("transcript/delta", { role: "user", delta: "Bonjour Astra" });
  expect(f.voice.snapshot().transcript).toBe("Bonjour Astra");
  f.realtime("transcript/done", { role: "user", text: "Bonjour Astra" });
  f.realtime("transcript/delta", { role: "assistant", delta: "Bonjour !" });
  expect(f.voice.snapshot().status).toBe("speaking");
  f.realtime("transcript/done", { role: "assistant", text: "Bonjour !" });
  expect(f.voice.snapshot().reply).toBe("Bonjour !");
  expect(f.voice.snapshot().status).toBe("listening");
  f.realtime("transcript/delta", { role: "user", delta: "Hello again" });
  expect(f.voice.snapshot().transcript).toBe("Hello again");
  expect(f.voice.snapshot().reply).toBe("");
  expect(f.sent).toEqual([]);
  f.voice.stop();
});

test("a completed Home command navigates directly and leaves background work running", async () => {
  const f = fixture();
  await f.voice.start();
  f.realtime("transcript/delta", { role: "user", delta: "Home" });
  expect(f.homeRequests()).toBe(0);
  f.realtime("transcript/done", { role: "user", text: " Home! " });
  await tick();
  expect(f.homeRequests()).toBe(1);
  expect(f.sent).toEqual([]);
  expect(f.calls).toEqual(["offer", "answer"]);
  expect(f.muted).toEqual([true]);
  f.realtime("transcript/delta", { role: "assistant", delta: "stale reply" });
  expect(f.voice.snapshot().reply).toBe("");
  f.realtime("transcript/delta", { role: "user", delta: "Ouvre le dashboard" });
  expect(f.muted).toEqual([true, false]);
  f.realtime("transcript/done", { role: "user", text: "Home." });
  await tick();
  expect(f.homeRequests()).toBe(2);
  f.voice.stop();
});

test("mentions of Home and assistant speech do not trigger navigation", async () => {
  const f = fixture();
  await f.voice.start();
  for (const text of [
    "Home Assistant",
    "Je veux modifier Home",
    "On dit Home alors",
    "homepage",
  ])
    f.realtime("transcript/done", { role: "user", text });
  f.realtime("transcript/done", { role: "assistant", text: "Home" });
  await tick();
  expect(f.homeRequests()).toBe(0);
  f.voice.stop();
});

test("local Home works while speaking even when the live transcript merges the command with a follow-up", async () => {
  const f = fixture();
  await f.voice.start();
  await tick();
  expect(f.shortcutStarts()).toBe(1);
  expect(f.voice.snapshot().homeShortcutReady).toBe(true);
  f.realtime("transcript/delta", {
    role: "assistant",
    delta: "Le dashboard s’affiche.",
  });
  f.shortcut({ method: "voice/home" });
  await tick();
  expect(f.homeRequests()).toBe(1);
  f.realtime("transcript/done", {
    role: "user",
    text: "Home Home Maintenant, du coup, ça marche pas quand je suis en conversation avec toi",
  });
  await tick();
  expect(f.homeRequests()).toBe(1);
  expect(f.sent).toEqual([]);
  expect(f.mediaStops()).toBe(0);
  f.voice.stop();
  expect(f.shortcutStops()).toBe(1);
  expect(f.voice.snapshot().homeShortcutReady).toBe(false);
  f.shortcut({ method: "voice/home" });
  await tick();
  expect(f.homeRequests()).toBe(1);
});

test("the local detector and live transcription perform one Home navigation", async () => {
  const f = fixture();
  await f.voice.start();
  await tick();
  f.shortcut({ method: "voice/home" });
  f.realtime("transcript/delta", { role: "user", delta: "Home" });
  f.realtime("transcript/done", { role: "user", text: "Home." });
  await tick();
  expect(f.homeRequests()).toBe(1);
  expect(f.muted).toEqual([true]);
  f.realtime("transcript/delta", { role: "user", delta: "Ouvre le dashboard" });
  expect(f.muted).toEqual([true, false]);
  f.shortcut({ method: "voice/wake" });
  expect(f.calls).toEqual(["offer", "answer"]);
  f.voice.stop();
});

test("an unavailable local shortcut reports its failure and keeps the live conversation connected", async () => {
  const f = fixture({ shortcutError: new Error("Microphone unavailable") });
  await f.voice.start();
  await tick();
  expect(f.voice.snapshot().error).toContain("Home shortcut unavailable");
  expect(f.voice.snapshot().active).toBe(true);
  expect(f.mediaStops()).toBe(0);
  f.voice.stop();
});

test("Home works during local standby without opening a live call", async () => {
  const f = fixture();
  await f.voice.start(true);
  f.wake({ method: "voice/home" });
  await tick();
  expect(f.homeRequests()).toBe(1);
  expect(f.calls).toEqual([]);
  expect(f.sent).toEqual([]);
  expect(f.voice.snapshot().status).toBe("standby");
  f.voice.stop();
  f.wake({ method: "voice/home" });
  await tick();
  expect(f.homeRequests()).toBe(1);
});

test("Astra Home uses the shortcut instead of sending a backend message", async () => {
  const f = fixture();
  await f.voice.start(true);
  f.wake({ method: "voice/wake" });
  f.wake({ method: "voice/final", text: "Astra, Home." });
  await tick();
  expect(f.homeRequests()).toBe(1);
  expect(f.sent).toEqual([]);
  f.voice.stop();
});

test("a failed Home navigation reports the error without ending voice", async () => {
  const f = fixture({ homeError: new Error("Astra's window is unavailable.") });
  await f.voice.start();
  f.realtime("transcript/done", { role: "user", text: "Home" });
  await tick();
  expect(f.voice.snapshot().error).toContain("window is unavailable");
  expect(f.voice.snapshot().active).toBe(true);
  f.voice.stop();
});

test("interruption flushes speech and cancels work, then new speech restores output", async () => {
  const f = fixture();
  await f.voice.start();
  f.realtime("transcript/delta", { role: "assistant", delta: "A long answer" });
  await f.voice.interrupt();
  expect(f.muted).toEqual([true]);
  expect(f.calls).toContain(`interrupt:${f.assistant.id}`);
  f.realtime("transcript/delta", { role: "assistant", delta: "stale audio" });
  expect(f.voice.snapshot().reply).toBe("A long answer");
  f.realtime("transcript/delta", { role: "user", delta: "Actually" });
  expect(f.muted).toEqual([true, false]);
  expect(f.voice.snapshot().status).toBe("listening");
  f.voice.stop();
});

test("a follow-up spoken sentence keeps the useful completed result visible", async () => {
  const f = fixture();
  await f.voice.start();
  f.realtime("transcript/delta", {
    role: "assistant",
    delta: "Mini Lune est ouverte.",
  });
  f.realtime("transcript/done", {
    role: "assistant",
    text: "Mini Lune est ouverte.",
  });
  f.realtime("transcript/delta", {
    role: "assistant",
    delta: "Tu peux utiliser le compteur.",
  });
  f.realtime("transcript/done", {
    role: "assistant",
    text: "Tu peux utiliser le compteur.",
  });
  expect(f.voice.snapshot().reply).toBe(
    "Mini Lune est ouverte. Tu peux utiliser le compteur.",
  );
  f.voice.stop();
});

test("ending voice releases the microphone and ignores stale events", async () => {
  const f = fixture();
  await f.voice.start();
  f.voice.stop();
  f.realtime("transcript/delta", { role: "assistant", delta: "stale" });
  f.media({ method: "voice/error", message: "late error" });
  expect(f.mediaStops()).toBe(1);
  expect(f.voice.snapshot().status).toBe("off");
  expect(f.voice.snapshot().reply).toBe("");
});

test("failed audio startup reports the real error and releases the microphone", async () => {
  const f = fixture({ mediaError: new Error("Enable Microphone for Astra.") });
  await expect(f.voice.start()).rejects.toThrow("Enable Microphone");
  expect(f.mediaStops()).toBe(1);
  expect(f.voice.snapshot().status).toBe("error");
  expect(f.voice.snapshot().active).toBe(false);
});

test("backend voice failures appear on the galaxy instead of leaving it listening", async () => {
  const f = fixture();
  await f.voice.start();
  f.realtime("error", { message: "Live connection unavailable" });
  expect(f.voice.snapshot().status).toBe("error");
  expect(f.voice.snapshot().error).toBe("Live connection unavailable");
  expect(f.mediaStops()).toBe(1);
});

test("stopping during negotiation cancels startup without a false failure", async () => {
  const f = fixture({ autoSdp: false });
  const starting = f.voice.start();
  await tick();
  f.voice.stop();
  await starting;
  expect(f.voice.snapshot().status).toBe("off");
  expect(f.voice.snapshot().error).toBeNull();
});

test("wake permission failure releases the helper and reports an error", async () => {
  const f = fixture({ wakeError: new Error("Enable Microphone for Astra.") });
  await expect(f.voice.start(true)).rejects.toThrow("Enable Microphone");
  expect(f.voice.snapshot().status).toBe("error");
  expect(f.voice.snapshot().active).toBe(false);
  expect(f.wakeStops()).toBe(1);
});
