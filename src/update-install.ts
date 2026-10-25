import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, createReadStream, existsSync } from "node:fs";
import { access, lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, win32 } from "node:path";
import type { PreparedUpdate } from "./updates";

const SHELL_INSTALLER = String.raw`#!/bin/bash
set -euo pipefail
WAIT_SECONDS=60
attempts=0
while kill -0 "$ASTRA_UPDATE_PARENT" 2>/dev/null; do
  if [[ "$attempts" -ge "$WAIT_SECONDS" ]]; then
    printf 'Astra did not close within 60 seconds. The update was not installed.\n' > "$ASTRA_UPDATE_LOG"
    cp "$ASTRA_UPDATE_LOG" "$ASTRA_UPDATE_ERROR"
    exit 1
  fi
  sleep 1
  attempts=$((attempts + 1))
done
if /bin/bash "$ASTRA_UPDATE_INSTALLER" > "$ASTRA_UPDATE_LOG" 2>&1; then
  if [[ "$ASTRA_UPDATE_PLATFORM" == "linux" && "$ASTRA_NO_OPEN" != "1" ]]; then
    "$ASTRA_UPDATE_EXECUTABLE" >/dev/null 2>&1 &
  fi
else
  printf '\nAstra update failed. The previous installation and saved apps were retained where possible.\n' >> "$ASTRA_UPDATE_LOG"
  cp "$ASTRA_UPDATE_LOG" "$ASTRA_UPDATE_ERROR"
  if [[ "$ASTRA_NO_OPEN" != "1" ]]; then
    if [[ "$ASTRA_UPDATE_PLATFORM" == "darwin" ]]; then
      if ! /usr/bin/open "$ASTRA_UPDATE_APPLICATION" >> "$ASTRA_UPDATE_LOG" 2>&1; then
        printf 'Open Astra manually and inspect this installation log.\n' >> "$ASTRA_UPDATE_LOG"
      fi
    else
      "$ASTRA_UPDATE_EXECUTABLE" >/dev/null 2>&1 &
    fi
  fi
  exit 1
fi
`;

const WINDOWS_INSTALLER = `$ErrorActionPreference='Stop'
try {
  $parentProcess=Get-Process -Id ([int]$env:ASTRA_UPDATE_PARENT) -ErrorAction SilentlyContinue
  if ($parentProcess) {Wait-Process -Id $parentProcess.Id -Timeout 60 -ErrorAction Stop}
  & $env:ASTRA_UPDATE_POWERSHELL -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $env:ASTRA_UPDATE_INSTALLER *> $env:ASTRA_UPDATE_LOG
  if ($LASTEXITCODE -ne 0) {throw "Astra installer failed (exit $LASTEXITCODE)."}
} catch {
  $_ | Out-String | Add-Content -LiteralPath $env:ASTRA_UPDATE_LOG
  Copy-Item -LiteralPath $env:ASTRA_UPDATE_LOG -Destination $env:ASTRA_UPDATE_ERROR -Force
  if ($env:ASTRA_NO_OPEN -ne '1') {Start-Process -FilePath $env:ASTRA_UPDATE_EXECUTABLE}
  exit 1
}
`;

export type UpdateInstall = {
  command: string;
  args: string[];
  environment: NodeJS.ProcessEnv;
  log: string;
};

async function stageHelper(path: string, contents: Buffer | string) {
  const expected =
    typeof contents === "string" ? Buffer.from(contents) : contents;
  try {
    await writeFile(path, expected, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (
      !(await lstat(path)).isFile() ||
      !(await readFile(path)).equals(expected)
    )
      throw new Error(
        "The staged update helper changed. Download the update again.",
      );
  }
}

export async function prepareUpdateInstall(
  update: PreparedUpdate,
  target: {
    cacheDirectory: string;
    appPath: string;
    executable: string;
    platform: string;
    parentPid: number;
  },
): Promise<UpdateInstall> {
  if (
    !["darwin", "win32", "linux"].includes(target.platform) ||
    !Number.isSafeInteger(target.parentPid) ||
    target.parentPid < 1
  )
    throw new Error("Unsupported update installation target.");
  const root = await realpath(target.cacheDirectory);
  if (
    dirname(update.directory) !== root ||
    (await realpath(update.directory)) !== update.directory ||
    (await readFile(join(update.directory, ".owner"), "utf8")) !==
      update.owner ||
    dirname(update.archive) !== update.directory ||
    !(await lstat(update.archive)).isFile()
  )
    throw new Error("The update is outside its owned download directory.");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(update.archive))
    hash.update(chunk);
  if (hash.digest("hex") !== update.sha256)
    throw new Error(
      "The cached update checksum changed. Download the update again.",
    );
  const log = join(update.directory, "install.log");
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    ASTRA_UPDATE_PARENT: String(target.parentPid),
    ASTRA_UPDATE_ARCHIVE: update.archive,
    ASTRA_UPDATE_VERSION: `v${update.version}`,
    ASTRA_UPDATE_PLATFORM: target.platform,
    ASTRA_UPDATE_EXECUTABLE: target.executable,
    ASTRA_UPDATE_LOG: log,
    ASTRA_UPDATE_ERROR: join(root, "last-error.log"),
    ASTRA_NO_OPEN: process.env.ASTRA_NO_OPEN ?? "0",
  };
  let command = "/bin/bash";
  let args: string[];
  if (target.platform === "win32") {
    const installRoot = win32.join(
      process.env.LOCALAPPDATA ?? "",
      "Programs",
      "Astra",
    );
    const destination = win32.dirname(target.executable);
    if (
      !process.env.LOCALAPPDATA ||
      win32.dirname(destination).toLowerCase() !== installRoot.toLowerCase() ||
      win32.basename(target.executable).toLowerCase() !== "astra.exe"
    )
      throw new Error(
        "Install Astra with its Windows installer before using in-app updates.",
      );
    command = win32.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    environment.ASTRA_UPDATE_POWERSHELL = command;
    environment.ASTRA_UPDATE_DESTINATION = destination;
    const script = join(update.directory, "install.ps1");
    await stageHelper(
      script,
      await readFile(join(target.appPath, "dist/install.ps1")),
    );
    environment.ASTRA_UPDATE_INSTALLER = script;
    const helper = join(update.directory, "update.ps1");
    await stageHelper(helper, WINDOWS_INSTALLER);
    args = [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      helper,
    ];
  } else {
    if (target.platform === "darwin") {
      const application = resolve(target.appPath, "../../..");
      if (
        basename(application) !== "Astra.app" ||
        target.appPath !== join(application, "Contents/Resources/app")
      )
        throw new Error(
          "Install the packaged Astra app before using in-app updates.",
        );
      environment.ASTRA_INSTALL_DIR = dirname(application);
      environment.ASTRA_UPDATE_APPLICATION = application;
      try {
        await access(dirname(application), constants.W_OK);
      } catch (error) {
        throw new Error(
          "Astra's installation directory is not writable. Move Astra to your Applications folder or update it manually.",
          { cause: error },
        );
      }
    } else {
      if (
        target.executable !== "/usr/lib/astra/astra" ||
        !existsSync("/usr/bin/pkexec")
      )
        throw new Error(
          "In-app Linux updates require the Astra Debian package and pkexec. Update through your package manager.",
        );
      environment.ASTRA_UPDATE_GUI = "1";
    }
    const script = join(update.directory, "install.sh");
    await stageHelper(
      script,
      await readFile(join(target.appPath, "dist/install.sh")),
    );
    environment.ASTRA_UPDATE_INSTALLER = script;
    const helper = join(update.directory, "update.sh");
    await stageHelper(helper, SHELL_INSTALLER);
    args = [helper];
  }
  return { command, args, environment, log };
}

export async function launchUpdateInstaller(installation: UpdateInstall) {
  const child = spawn(installation.command, installation.args, {
    env: installation.environment,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
}
