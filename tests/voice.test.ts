import { expect, test } from "bun:test";
import { newWorkspace } from "../src/storage";
import type { Snapshot } from "../src/types";
import { type SpeechEvent, spokenReply, VoiceSession } from "../src/voice";

function fixture(startError?: Error) {
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
  const sent: { text: string; id?: string }[] = [];
  const spoken: { text: string; id: number; language: string }[] = [];
  const interrupted: string[] = [];
  let nativeStops = 0;
  let speechInterrupts = 0;
  let onEvent: (event: SpeechEvent) => void = () => {};
  const voice = new VoiceSession(
    {
      ensureAssistantWorkspace: () => assistant.id,
      send: async (text, id) => {
        sent.push({ text, id });
      },
      interrupt: async (id) => {
        if (id) interrupted.push(id);
      },
      snapshot: () => snapshot,
      answer: () => {},
    },
    (listener) => {
      onEvent = listener;
      return {
        start: async () => {
          if (startError) throw startError;
        },
        listen: async () => {},
        standby: async () => {},
        speak: async (text, id, language) => {
          spoken.push({ text, id, language });
        },
        interrupt: async () => {
          speechInterrupts++;
        },
        stop: () => {
          nativeStops++;
        },
      };
    },
    () => {},
  );
  const working = (busy: boolean) => {
    snapshot.sessions[assistant.id] = {
      busy,
      activity: busy ? "Working" : "Ready",
      approval: null,
      error: null,
      metrics: null,
      settings: null,
    };
    voice.observe(snapshot);
  };
  return {
    voice,
    snapshot,
    assistant,
    sent,
    spoken,
    interrupted,
    working,
    event: (event: SpeechEvent) => onEvent(event),
    stops: () => nativeStops,
    speechInterrupts: () => speechInterrupts,
  };
}

test("voice uses the Home agent, speaks completed results, and returns to listening", async () => {
  const f = fixture();
  await f.voice.start();
  expect(f.voice.snapshot().status).toBe("listening");
  await f.voice.submit("Open Calculator");
  expect(f.sent).toEqual([{ text: "Open Calculator", id: f.assistant.id }]);
  f.working(true);
  expect(f.spoken).toEqual([]);
  f.assistant.messages.push({
    id: "reply",
    role: "assistant",
    text: "**Calculator** is open.",
  });
  f.working(false);
  expect(f.spoken[0].text).toBe("Calculator is open.");
  f.event({ method: "voice/finished", speechId: f.spoken[0].id });
  expect(f.voice.snapshot().status).toBe("listening");
});

test("barge-in stops speech immediately and subsequent guidance uses the same agent", async () => {
  const f = fixture();
  await f.voice.start();
  await f.voice.submit("Summarize the result");
  f.working(true);
  f.assistant.messages.push({
    id: "reply",
    role: "assistant",
    text: "Here is the result.",
  });
  f.working(false);
  const oldId = f.spoken[0].id;
  const before = f.speechInterrupts();
  f.event({ method: "voice/partial", text: "Actually" });
  expect(f.speechInterrupts()).toBe(before + 1);
  expect(f.voice.snapshot().transcript).toBe("Actually");
  await f.voice.submit("Actually create a timer");
  f.working(true);
  f.event({ method: "voice/finished", speechId: oldId });
  expect(f.voice.snapshot().status).toBe("thinking");
  expect(f.sent.at(-1)?.id).toBe(f.assistant.id);
});

test("spoken stop interrupts work without creating another agent request", async () => {
  const f = fixture();
  await f.voice.start();
  await f.voice.submit("Work on this");
  f.working(true);
  await f.voice.submit("Astra, stop.");
  f.working(false);
  expect(f.interrupted).toEqual([f.assistant.id]);
  expect(f.sent).toHaveLength(1);
  expect(f.spoken).toHaveLength(0);
  expect(f.voice.snapshot().status).toBe("listening");
});

test("ending a session releases the microphone and ignores stale recognition events", async () => {
  const f = fixture();
  await f.voice.start();
  f.voice.stop();
  f.event({ method: "voice/final", text: "Open Calculator" });
  expect(f.stops()).toBe(1);
  expect(f.sent).toHaveLength(0);
  expect(f.voice.snapshot().active).toBe(false);
});

test("denied microphone access stops the helper and reports an actionable error", async () => {
  const f = fixture(
    new Error("Enable Microphone for Astra in System Settings."),
  );
  await expect(f.voice.start()).rejects.toThrow("Enable Microphone");
  expect(f.stops()).toBe(1);
  expect(f.voice.snapshot().status).toBe("error");
  expect(f.voice.snapshot().active).toBe(false);
});

test("spoken replies omit generated code, image URLs, and Markdown decoration", () => {
  expect(
    spokenReply(
      'Done.\n```substrate\n{"op":"remove"}\n```\nSee [the result](https://example.com).',
    ),
  ).toBe("Done. See the result.");
  expect(spokenReply("```substrate\npartial generated code")).toBe("");
});

test("background wake enables a command while standby ignores ambient speech", async () => {
  const f = fixture();
  await f.voice.start(true);
  expect(f.voice.snapshot().status).toBe("standby");
  f.event({ method: "voice/final", text: "ambient conversation" });
  expect(f.sent).toHaveLength(0);
  f.event({ method: "voice/wake" });
  expect(f.voice.snapshot().status).toBe("listening");
  f.event({
    method: "voice/final",
    text: "Astra, ouvre la calculatrice",
    language: "fr",
  });
  await Bun.sleep(0);
  expect(f.sent.at(-1)?.text).toBe("ouvre la calculatrice");
  expect(f.voice.snapshot().language).toBe("fr");
  f.working(true);
  f.assistant.messages.push({
    id: "french-reply",
    role: "assistant",
    text: "La calculatrice est ouverte.",
  });
  f.working(false);
  expect(f.spoken.at(-1)?.language).toBe("fr");
  f.voice.stop();
});

test("French stop cancels the current turn and does not send another request", async () => {
  const f = fixture();
  await f.voice.start();
  await f.voice.submit("Fais ceci");
  f.working(true);
  await f.voice.submit("Astra, arrête.");
  expect(f.interrupted).toEqual([f.assistant.id]);
  expect(f.sent).toHaveLength(1);
  f.voice.stop();
});

test("steering preserves the current assistant reply for speech", async () => {
  const f = fixture();
  await f.voice.start();
  await f.voice.submit("Create a timer");
  f.working(true);
  f.assistant.messages.push({
    id: "streaming",
    role: "assistant",
    text: "Creating",
  });
  await f.voice.submit("Make it five minutes");
  f.working(true);
  const reply = f.assistant.messages.at(-1);
  if (!reply) throw new Error("Missing streaming reply");
  reply.text = "Your five-minute timer is ready.";
  f.working(false);
  expect(f.spoken.at(-1)?.text).toBe("Your five-minute timer is ready.");
  f.voice.stop();
});
