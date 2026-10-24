import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const output = join(homedir(), ".astra/media/getastra-pitch");
const assets = join(root, ".github/assets");
const FPS = 24;
const SAMPLE_RATE = 44_100;
const SPEAKING_RATE = 172;
const INTRO_DELAY = 0.8;
const CHAPTER_GAP = 0.5;
const END_DELAY = 1;
const FRAME_WIDTH = 1280;
const FRAME_HEIGHT = 720;
const stillsOnly = process.argv.includes("--stills");
mkdirSync(output, { recursive: true, mode: 0o700 });
mkdirSync(assets, { recursive: true });

const lines = JSON.parse(
  readFileSync(join(root, "website/media/narration.json"), "utf8"),
) as { id: string; text: string; minimum: number }[];
const starts: number[] = [];
const lengths: number[] = [];
const captions: { start: number; end: number; text: string }[] = [];
let cursor = INTRO_DELAY;
for (const line of lines) {
  const textFile = join(output, `${line.id}.txt`);
  writeFileSync(textFile, line.text);
  const audio = join(output, `${line.id}.aiff`);
  execFileSync("/usr/bin/say", [
    "-v",
    "Daniel",
    "-r",
    String(SPEAKING_RATE),
    "-f",
    textFile,
    "-o",
    audio,
  ]);
  const duration = Number(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        audio,
      ],
      { encoding: "utf8" },
    ).trim(),
  );
  if (!Number.isFinite(duration) || duration <= 0)
    throw Error(`Speech output is empty: ${line.id}`);
  starts.push(cursor);
  lengths.push(duration);
  const phrases = line.text.match(/[^.!?]+[.!?]+/g) ?? [line.text];
  let captionStart = cursor;
  const wordCount = line.text.split(/\s+/).length;
  for (const phrase of phrases) {
    const text = phrase.trim();
    const length = (duration * text.split(/\s+/).length) / wordCount;
    captions.push({ start: captionStart, end: captionStart + length, text });
    captionStart += length;
  }
  cursor += Math.max(duration, line.minimum) + CHAPTER_GAP;
}
const duration = Math.ceil((cursor - CHAPTER_GAP + END_DELAY) * FPS) / FPS;
const timeline = {
  fps: FPS,
  width: FRAME_WIDTH,
  height: FRAME_HEIGHT,
  duration,
  starts,
  durations: lengths,
  chapters: [0, ...starts.slice(1)],
};
writeFileSync(join(output, "timeline.json"), JSON.stringify(timeline, null, 2));
writeFileSync(join(output, "captions.json"), JSON.stringify(captions, null, 2));

const channels = 2,
  bytesPerSample = 2;
const music = Buffer.alloc(
  44 + Math.round(duration * SAMPLE_RATE) * channels * bytesPerSample,
);
music.write("RIFF", 0);
music.writeUInt32LE(music.length - 8, 4);
music.write("WAVEfmt ", 8);
music.writeUInt32LE(16, 16);
music.writeUInt16LE(1, 20);
music.writeUInt16LE(channels, 22);
music.writeUInt32LE(SAMPLE_RATE, 24);
music.writeUInt32LE(SAMPLE_RATE * channels * bytesPerSample, 28);
music.writeUInt16LE(channels * bytesPerSample, 32);
music.writeUInt16LE(16, 34);
music.write("data", 36);
music.writeUInt32LE(music.length - 44, 40);
const chords = [
  [130.8128, 164.8138, 195.9977, 246.9417],
  [110, 164.8138, 220, 261.6256],
  [87.3071, 130.8128, 174.6141, 220],
  [97.9989, 146.8324, 195.9977, 246.9417],
];
for (let sample = 0; sample < (music.length - 44) / 4; sample++) {
  const t = sample / SAMPLE_RATE,
    local = t % 4.8;
  const envelope = Math.min(1, local / 0.16) * Math.min(1, (4.8 - local) / 0.7);
  const pad =
    chords[Math.floor(t / 4.8) % chords.length].reduce(
      (sum, f) => sum + Math.sin(2 * Math.PI * f * t),
      0,
    ) *
    0.006 *
    envelope;
  const pluck =
    Math.sin(2 * Math.PI * 523.251 * t) * Math.exp(-(t % 0.6) * 22) * 0.008;
  const fade = Math.min(1, t / 0.8) * Math.min(1, (duration - t) / 1.4);
  const value = Math.round(32767 * (pad + pluck) * fade);
  music.writeInt16LE(value, 44 + sample * 4);
  music.writeInt16LE(value, 46 + sample * 4);
}
writeFileSync(join(output, "score.wav"), music);
const filters = starts.map(
  (start, index) =>
    `[${index}:a]loudnorm=I=-17:TP=-2:LRA=8,aresample=${SAMPLE_RATE},adelay=${Math.round(start * 1000)}|${Math.round(start * 1000)}[v${index}]`,
);
filters.push("[5:a]volume=0.6[music]");
filters.push(
  starts.map((_start, i) => `[v${i}]`).join("") +
    "[music]amix=inputs=6:normalize=0,alimiter=limit=0.88,apad[mix]",
);
execFileSync("ffmpeg", [
  "-y",
  "-v",
  "error",
  ...lines.flatMap((line) => ["-i", join(output, `${line.id}.aiff`)]),
  "-i",
  join(output, "score.wav"),
  "-filter_complex",
  filters.join(";"),
  "-map",
  "[mix]",
  "-t",
  String(duration),
  "-ar",
  String(SAMPLE_RATE),
  join(output, "audio.wav"),
]);
execFileSync("ffmpeg", [
  "-y",
  "-v",
  "error",
  "-i",
  join(root, "assets/astra-icon.png"),
  "-vf",
  "scale=96:96",
  "-frames:v",
  "1",
  join(assets, "icon.png"),
]);
const config = join(output, "render.json");
writeFileSync(
  config,
  JSON.stringify({ root, output, assets, timeline, captions, stillsOnly }),
);
const browser = join(
  root,
  "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
);
await new Promise<void>((resolve, reject) => {
  const child = spawn(
    browser,
    [join(root, "website/media/render.cjs"), config],
    { stdio: "inherit" },
  );
  child.on("error", reject);
  child.on("exit", (code) =>
    code === 0
      ? resolve()
      : reject(Error(`Pitch rendering failed with exit ${code}`)),
  );
});
if (!stillsOnly) {
  execFileSync("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-framerate",
    String(FPS),
    "-i",
    join(output, "frames/%05d.jpg"),
    "-i",
    join(output, "audio.wav"),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    "-shortest",
    join(assets, "astra-pitch-en.mp4"),
  ]);
  const stamp = (seconds: number) =>
    new Date(Math.round(seconds * 1000)).toISOString().slice(11, 23);
  writeFileSync(
    join(assets, "astra-pitch-en.vtt"),
    "WEBVTT\n\n" +
      captions
        .map((c) => `${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`)
        .join("\n"),
  );
  execFileSync("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-i",
    join(assets, "astra-pitch-en.mp4"),
    "-ss",
    "2",
    "-frames:v",
    "1",
    join(assets, "film-poster.png"),
  ]);
  console.log(
    JSON.stringify({
      video: join(assets, "astra-pitch-en.mp4"),
      duration,
      language: "en",
      voice: "Daniel",
      modelCalls: 0,
    }),
  );
}
