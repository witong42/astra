import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { appleScriptRequestSchema } from "./applescript";

export const SHELL_SCRIPT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_CONCURRENT_SCRIPTS = 4;
let running = 0;

export async function runShellScript(
  request: unknown,
  cwd = process.cwd(),
): Promise<string> {
  const { script, args } = appleScriptRequestSchema.parse(request);
  if (process.platform !== "linux")
    throw new Error("Shell actions require Linux.");
  if (running >= MAX_CONCURRENT_SCRIPTS)
    throw new Error(
      "Four shell actions are already running. Try again when one finishes.",
    );
  running++;
  try {
    if (!(await stat(cwd)).isDirectory())
      throw new Error(`Shell workspace is not a directory: ${cwd}`);
    return await execute(script, args, cwd);
  } finally {
    running--;
  }
}

function execute(script: string, args: string[], cwd: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("/bin/sh", ["-e", "-s", "--", ...args], {
      cwd,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let finished = false;
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error && child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (failure) {
          if ((failure as NodeJS.ErrnoException).code !== "ESRCH")
            error = new Error(`Could not stop the shell action: ${failure}`);
        }
      }
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      if (error) reject(error);
      else resolve(Buffer.concat(stdout).toString("utf8").trimEnd());
    };
    const timer = setTimeout(
      () => finish(new Error("Shell action exceeded its 30 second limit.")),
      SHELL_SCRIPT_TIMEOUT_MS,
    );
    const collect = (destination: Buffer[], chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES)
        finish(new Error("Shell output exceeded its 64 KB limit."));
      else destination.push(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
    child.once("error", finish);
    child.once("close", (code, signal) =>
      finish(
        code === 0
          ? undefined
          : new Error(
              Buffer.concat(stderr).toString("utf8").trim() ||
                `Shell action stopped with ${signal ?? `exit code ${code}`}.`,
            ),
      ),
    );
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") finish(error);
    });
    child.stdin.end(script);
  });
}
