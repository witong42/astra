import { execFile } from "node:child_process";
import { z } from "zod";

export const APPLESCRIPT_TIMEOUT_MS = 30_000;
export const APPLESCRIPT_MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_CONCURRENT_SCRIPTS = 4;
export const appleScriptRequestSchema = z
  .object({
    script: z
      .string()
      .trim()
      .min(1)
      .max(64 * 1024),
    args: z.array(z.string().max(4000)).max(32).default([]),
  })
  .strict();
export type AppleScriptRequest = z.infer<typeof appleScriptRequestSchema>;
let running = 0;

export async function runAppleScript(request: unknown): Promise<string> {
  const { script, args } = appleScriptRequestSchema.parse(request);
  if (process.platform !== "darwin")
    throw new Error("AppleScript actions require macOS.");
  if (running >= MAX_CONCURRENT_SCRIPTS)
    throw new Error(
      "Four AppleScript actions are already running. Try again when one finishes.",
    );
  running++;
  try {
    return await new Promise<string>((resolve, reject) => {
      const child = execFile(
        "/usr/bin/osascript",
        ["-", ...args],
        {
          timeout: APPLESCRIPT_TIMEOUT_MS,
          maxBuffer: APPLESCRIPT_MAX_OUTPUT_BYTES,
          encoding: "utf8",
        },
        (error, stdout, stderr) => {
          if (error) {
            const reason =
              error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
                ? "AppleScript output exceeded its 64 KB limit."
                : error.killed
                  ? "AppleScript exceeded its 30 second limit."
                  : stderr.trim() || error.message;
            reject(new Error(reason));
          } else resolve(stdout.trimEnd());
        },
      );
      child.stdin?.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "EPIPE") reject(error);
      });
      child.stdin?.end(script);
    });
  } finally {
    running--;
  }
}
