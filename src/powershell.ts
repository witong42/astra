import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appleScriptRequestSchema } from "./applescript";

const SCRIPT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_CONCURRENT_SCRIPTS = 4;
let running = 0;

export async function runPowerShell(request: unknown): Promise<string> {
  const parsed = appleScriptRequestSchema.parse(request);
  if (process.platform !== "win32")
    throw new Error("PowerShell actions require Windows.");
  if (running >= MAX_CONCURRENT_SCRIPTS)
    throw new Error(
      "Four PowerShell actions are already running. Try again when one finishes.",
    );
  running++;
  let directory: string | null = null;
  try {
    directory = mkdtempSync(join(tmpdir(), "astra-action-"));
    const path = join(directory, "request.json");
    writeFileSync(path, JSON.stringify(parsed), { mode: 0o600 });
    const encodedPath = Buffer.from(path).toString("base64");
    const bootstrap = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
  $path = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}'))
  $request = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8) | ConvertFrom-Json
  $arguments = @($request.args)
  & ([scriptblock]::Create($request.script)) @arguments
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
} catch { [Console]::Error.WriteLine($_.ToString()); exit 1 }
`;
    return await new Promise<string>((resolve, reject) => {
      execFile(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(bootstrap, "utf16le").toString("base64"),
        ],
        {
          encoding: "utf8",
          windowsHide: true,
          timeout: SCRIPT_TIMEOUT_MS,
          maxBuffer: MAX_OUTPUT_BYTES,
        },
        (error, stdout, stderr) => {
          if (!error) return resolve(stdout.trimEnd());
          reject(
            new Error(
              error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
                ? "PowerShell output exceeded its 64 KB limit."
                : error.killed
                  ? "PowerShell exceeded its 30 second limit."
                  : stderr.trim() || error.message,
            ),
          );
        },
      );
    });
  } finally {
    running--;
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
}
