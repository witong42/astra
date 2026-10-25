import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const skill = process.argv[2];
if (!skill || !existsSync(join(skill, "tools/build.mjs")))
  throw new Error(
    "Pass the animate skill directory: bun scripts/render-demo.ts /path/to/animate",
  );
const root = resolve(import.meta.dir, "..");
const raw = join(homedir(), ".astra/media/getastra-live-demo");
const piece = join(root, "test-results/astra-demo-blue-piece");
const edit = join(raw, "edit-creation");
const frames = join(edit, "native-frames");
const FPS = 30;
const DURATION = 30;
const FRAME_WIDTH = 1920;
const FRAME_HEIGHT = 1158;
const SOURCE_CLIP_FRAMES = [169, 112, 113, 225, 169, 112];
const USER_VOICE_START = 0.65;
const ACK_VOICE_START = 5.75;
const ASTRA_VOICE_START = 9.55;
const MINIMUM_VOICE_RMS = 0.015;
const VOICE_SAMPLE_RATE = 48_000;
const VOICE_SAMPLES = DURATION * VOICE_SAMPLE_RATE;
const MAX_VOICE_FILE_BYTES = VOICE_SAMPLES * 2 * 2 + 64 * 1024;
const IMAGE_QUALITY = "2";
const manifest = JSON.parse(
  readFileSync(join(raw, "creation-edit.json"), "utf8"),
) as {
  clips: { file: string; start: number; length: number }[];
  crop: number[];
  excludedSpeech: string[];
};
for (const file of [
  "creation-take-1.mov",
  "creation-take-2.mov",
  "creation-request.aiff",
  "creation-ack.wav",
  "creation-ready.wav",
  "creation-ready.json",
])
  if (!existsSync(join(raw, file)))
    throw new Error(`Missing the actual creation recording: ${file}`);
for (const file of [
  "astra-demo.html",
  "astra-demo-score.js",
  "astra-demo.json",
])
  if (!existsSync(join(root, "website/media", file)))
    throw new Error(`Missing demo source: ${file}`);
if (
  SOURCE_CLIP_FRAMES.reduce((sum, count) => sum + count, 0) !==
    FPS * DURATION ||
  manifest.clips.length !== SOURCE_CLIP_FRAMES.length
)
  throw new Error("The creation source clips must contain exactly 900 frames.");
for (const directory of [edit, join(piece, "src"), join(piece, "voice")])
  mkdirSync(directory, { recursive: true });
const run = (args: string[]) =>
  execFileSync("ffmpeg", ["-y", "-v", "error", ...args], { stdio: "inherit" });
const clips = manifest.clips;
for (const file of new Set(clips.map((clip) => clip.file))) {
  const probe = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "json",
        join(raw, file),
      ],
      { encoding: "utf8" },
    ),
  );
  const stream = probe.streams?.[0];
  if (!stream || stream.width < 2992 || stream.height < 1916)
    throw new Error(`The native capture is cropped or invalid: ${file}`);
}
for (const [index, clip] of clips.entries()) {
  const count = SOURCE_CLIP_FRAMES[index];
  run([
    "-ss",
    String(clip.start),
    "-t",
    String(clip.length),
    "-i",
    join(raw, clip.file),
    "-an",
    "-vf",
    "setpts=PTS-STARTPTS,fps=" +
      FPS +
      ",crop=" +
      manifest.crop.join(":") +
      ",scale=" +
      FRAME_WIDTH +
      ":" +
      FRAME_HEIGHT +
      `,setsar=1,tpad=stop_mode=clone:stop_duration=${DURATION},trim=end_frame=` +
      count,
    "-frames:v",
    String(count),
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "16",
    "-pix_fmt",
    "yuv420p",
    join(edit, `${index}.mp4`),
  ]);
  console.log(`Prepared genuine footage phrase ${index + 1}/${clips.length}`);
}
const base = join(edit, "base.mp4");
run([
  ...clips.flatMap((_, index) => ["-i", join(edit, `${index}.mp4`)]),
  "-filter_complex",
  clips.map((_, index) => `[${index}:v:0]`).join("") +
    "concat=n=" +
    clips.length +
    ":v=1:a=0[v]",
  "-map",
  "[v]",
  "-frames:v",
  String(FPS * DURATION),
  "-c:v",
  "libx264",
  "-preset",
  "fast",
  "-crf",
  "16",
  "-pix_fmt",
  "yuv420p",
  base,
]);
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });
run([
  "-i",
  base,
  "-vf",
  `fps=${FPS}`,
  "-frames:v",
  String(FPS * DURATION),
  "-q:v",
  IMAGE_QUALITY,
  join(frames, "%04d.jpg"),
]);
const astraReply = JSON.parse(
  readFileSync(join(raw, "creation-ready.json"), "utf8"),
);
const replyBytes = readFileSync(join(raw, "creation-ready.wav"));
if (
  new Bun.CryptoHasher("sha256").update(replyBytes).digest("hex") !==
  astraReply.sha256
)
  throw new Error(
    "The captured Astra reply does not match its recording evidence.",
  );
for (const file of [
  "creation-request.aiff",
  "creation-ack.wav",
  "creation-ready.wav",
]) {
  const pcm = execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-i",
      join(raw, file),
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "f32le",
      "-",
    ],
    { maxBuffer: 4 * 1024 * 1024 },
  );
  let energy = 0;
  for (let offset = 0; offset < pcm.length; offset += 4)
    energy += pcm.readFloatLE(offset) ** 2;
  const rms = Math.sqrt(energy / (pcm.length / 4));
  if (!Number.isFinite(rms) || rms < MINIMUM_VOICE_RMS)
    throw new Error(
      `The recorded voice is silent or too quiet: ${file}. Capture system output, not microphone leakage.`,
    );
}
const delayedVoice = (input: number, start: number) =>
  `[${input}:a]loudnorm=I=-16:TP=-2:LRA=7,aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round(start * 1000)}|${Math.round(start * 1000)}[v${input}]`;
run([
  "-i",
  join(raw, "creation-request.aiff"),
  "-i",
  join(raw, "creation-ready.wav"),
  "-i",
  join(raw, "creation-ack.wav"),
  "-filter_complex",
  delayedVoice(0, USER_VOICE_START) +
    ";" +
    delayedVoice(1, ASTRA_VOICE_START) +
    ";" +
    delayedVoice(2, ACK_VOICE_START) +
    `;[v0][v1][v2]amix=inputs=3:normalize=0,apad=whole_len=${VOICE_SAMPLES},atrim=end_sample=${VOICE_SAMPLES},asetpts=N/SR/TB[voice]`,
  "-map",
  "[voice]",
  "-ar",
  "48000",
  "-ac",
  "2",
  "-t",
  String(DURATION),
  "-fs",
  String(MAX_VOICE_FILE_BYTES),
  join(piece, "voice/voice.wav"),
]);
const voiceProbe = JSON.parse(
  execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      join(piece, "voice/voice.wav"),
    ],
    { encoding: "utf8" },
  ),
);
if (
  Math.abs(Number(voiceProbe.format.duration) - DURATION) >
  1 / VOICE_SAMPLE_RATE
)
  throw new Error(
    "The dialogue mix must contain exactly thirty seconds of audio.",
  );
const assetDirectory = join(piece, "assets");
rmSync(assetDirectory, { recursive: true, force: true });
mkdirSync(assetDirectory, { recursive: true });
const nativeFrames = readdirSync(frames)
  .filter((file) => file.endsWith(".jpg"))
  .sort();
if (nativeFrames.length !== DURATION * FPS)
  throw new Error(
    `Expected 900 genuine footage frames; found ${nativeFrames.length}`,
  );
const byHash = new Map<string, string>();
const names: string[] = [];
for (const [index, file] of nativeFrames.entries()) {
  const bytes = readFileSync(join(frames, file));
  const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  let name = byHash.get(hash);
  if (!name) {
    name = `f${String(index).padStart(4, "0")}.jpg`;
    byHash.set(hash, name);
    writeFileSync(join(assetDirectory, name), bytes);
  }
  names.push(name);
}
const source = readFileSync(
  join(root, "website/media/astra-demo.html"),
  "utf8",
);
const scriptStart = source.indexOf("<script>") + "<script>".length;
const scriptEnd = source.lastIndexOf("</script>");
const code = source.slice(scriptStart, scriptEnd);
const split = code.indexOf("const STYLE =");
if (split < 0 || scriptEnd < scriptStart)
  throw new Error(
    "The animation source is missing its script or style definition.",
  );
writeFileSync(
  join(piece, "src/head.html"),
  source.slice(0, scriptStart) +
    code.slice(0, split).replace(/^let ctx =.*\n/m, "") +
    "\nconst LOOP_T = DURATION;\nconst FOOTAGE_FILES = " +
    JSON.stringify(names) +
    ";\n",
);
writeFileSync(
  join(piece, "src/draw.js"),
  `ctx = document.getElementById('c').getContext('2d', {willReadFrequently:true});\n${code.slice(split)}`,
);
copyFileSync(
  join(root, "website/media/astra-demo-score.js"),
  join(piece, "src/score.js"),
);
const metadata = JSON.parse(
  readFileSync(join(root, "website/media/astra-demo.json"), "utf8"),
);
metadata.build = [
  "src/head.html",
  "kit/core.js",
  "src/draw.js",
  "kit/score-head.js",
  "src/score.js",
  "kit/score-tail.js",
];
metadata.voice = { file: "voice/voice.wav", music: -4, gain: 0 };
writeFileSync(join(piece, "piece.json"), JSON.stringify(metadata, null, 2));
writeFileSync(
  join(edit, "provenance.json"),
  JSON.stringify(
    {
      fps: FPS,
      duration: DURATION,
      frames: names.length,
      uniqueFrames: byHash.size,
      nativeFrameSize: [FRAME_WIDTH, FRAME_HEIGHT],
      clips,
      sourceClipFrames: SOURCE_CLIP_FRAMES,
      userVoice: {
        file: "creation-request.aiff",
        actuallyPlayedIntoMicrophone: true,
        start: USER_VOICE_START,
      },
      astraVoice: { ...astraReply, start: ASTRA_VOICE_START },
      sourceCrop: manifest.crop,
      story:
        "Create a daily dashboard, hear Astra answer, see and use the result",
      excludedSpeech: manifest.excludedSpeech,
    },
    null,
    2,
  ),
);
execFileSync(process.execPath, [join(skill, "tools/build.mjs"), piece], {
  stdio: "inherit",
});
if (!process.argv.includes("--prepare-only")) {
  const require = createRequire(join(skill, "tools/export.mjs"));
  const { chromium } = require("playwright");
  const executable = process.env.ASTRA_CHROMIUM_EXECUTABLE;
  if (executable) {
    const launch = chromium.launch.bind(chromium);
    chromium.launch = (options = {}) =>
      launch({ ...options, executablePath: executable });
  }
  const entry = join(skill, "tools/export.mjs");
  process.argv = [
    process.execPath,
    entry,
    piece,
    "--workers",
    "1",
    "--no-captions",
    "--share",
  ];
  await import(pathToFileURL(entry).href);
}
console.log(
  `Render source: ${piece}. Run the animate review before publishing.`,
);
