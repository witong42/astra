import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "99.1.2";
const ARCHIVE = `Astra-${VERSION}-windows-x64.zip`;
const WINDOWS = process.platform === "win32";
const TIMEOUT = 60_000;
const SOURCE = fileURLToPath(new URL("../install.ps1", import.meta.url));

function powershell(script: string, extra: Record<string, string> = {}) {
  return spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      Buffer.from(
        `$ProgressPreference='SilentlyContinue'; Import-Module Microsoft.PowerShell.Management,Microsoft.PowerShell.Utility; ${script}`,
        "utf16le",
      ).toString("base64"),
    ],
    { env: { ...process.env, ...extra }, encoding: "utf8", timeout: TIMEOUT },
  );
}

function fixture(scenario = "success") {
  const directory = mkdtempSync(join(tmpdir(), "astra web install [fixture] "));
  const application = join(directory, "Astra-win32-x64");
  const profile = join(directory, "personal-profile.json");
  const sentinel = join(directory, "installer-ran");
  const calls = join(directory, "requests.log");
  const temporary = join(directory, "downloads");
  mkdirSync(application);
  mkdirSync(temporary);
  writeFileSync(profile, "existing personal data");
  writeFileSync(join(application, "Astra.exe"), "fixture app");
  writeFileSync(join(application, "app-manifest.json"), "{}");
  if (scenario !== "missing installer")
    writeFileSync(
      join(application, "Install.ps1"),
      "$ErrorActionPreference='Stop'\nif ($env:ASTRA_INSTALL_SCENARIO -eq 'installer failure') {exit 7}\n[IO.File]::WriteAllText($env:ASTRA_INSTALL_SENTINEL,$PSScriptRoot)\n",
    );
  const env = {
    ASTRA_INSTALL_FIXTURE: directory,
    ASTRA_INSTALL_SOURCE: SOURCE,
    ASTRA_INSTALL_ARCHIVE: ARCHIVE,
    ASTRA_INSTALL_SCENARIO: scenario,
    ASTRA_INSTALL_SENTINEL: sentinel,
    ASTRA_INSTALL_CALLS: calls,
    TEMP: temporary,
    TMP: temporary,
  };
  const prepared = powershell(
    `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root=$env:ASTRA_INSTALL_FIXTURE
$archive=Join-Path $root $env:ASTRA_INSTALL_ARCHIVE
[IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $root 'Astra-win32-x64'),$archive,[IO.Compression.CompressionLevel]::Optimal,$true)
if ($env:ASTRA_INSTALL_SCENARIO -eq 'unsafe path') {
  $zip=[IO.Compression.ZipFile]::Open($archive,[IO.Compression.ZipArchiveMode]::Update)
  try {$zip.CreateEntry('Astra-win32-x64/../../outside.txt') | Out-Null} finally {$zip.Dispose()}
}
$name=$env:ASTRA_INSTALL_ARCHIVE
if ($env:ASTRA_INSTALL_SCENARIO -eq 'wrong checksum name') {$name='another-app.zip'}
$hash=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
[IO.File]::WriteAllText("$archive.sha256","$hash  $name" + [Environment]::NewLine)
if ($env:ASTRA_INSTALL_SCENARIO -eq 'corrupt download') {[IO.File]::AppendAllText($archive,'corruption')}
`,
    env,
  );
  if (prepared.status !== 0) {
    rmSync(directory, { recursive: true, force: true });
    throw new Error(prepared.stderr || prepared.error?.message);
  }
  return {
    sentinel,
    run() {
      return powershell(
        `
$ErrorActionPreference='Continue'
$ProgressPreference='Continue'
function Invoke-RestMethod {
  param($Uri,$Headers,$TimeoutSec,[switch]$UseBasicParsing)
  [IO.File]::AppendAllText($env:ASTRA_INSTALL_CALLS,"$Uri" + [Environment]::NewLine)
  if ($env:ASTRA_INSTALL_SCENARIO -eq 'invalid tag') {return @{tag_name='../../other'}}
  return @{tag_name='v${VERSION}'}
}
function Invoke-WebRequest {
  param($Uri,$OutFile,$TimeoutSec,[switch]$UseBasicParsing)
  [IO.File]::AppendAllText($env:ASTRA_INSTALL_CALLS,"$Uri" + [Environment]::NewLine)
  Copy-Item -LiteralPath (Join-Path $env:ASTRA_INSTALL_FIXTURE ($Uri.Split('/')[-1])) -Destination $OutFile
}
function Get-Process {
  param($Name,$ErrorAction)
  if ($env:ASTRA_INSTALL_SCENARIO -eq 'running app') {return @{Path=(Join-Path $env:LOCALAPPDATA 'Programs\\Astra\\1.0.0\\Astra.exe')}}
}
try {
  Get-Content -LiteralPath $env:ASTRA_INSTALL_SOURCE -Raw | Invoke-Expression
  if ($ErrorActionPreference -ne 'Continue' -or $ProgressPreference -ne 'Continue' -or (Test-Path variable:archiveName)) {throw 'Installer changed the caller scope.'}
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
`,
        env,
      );
    },
    requests() {
      return existsSync(calls)
        ? readFileSync(calls, "utf8").trim().split(/\r?\n/)
        : [];
    },
    verifyPreserved() {
      expect(readFileSync(profile, "utf8")).toBe("existing personal data");
      expect(readdirSync(temporary)).toEqual([]);
    },
    close() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test.skipIf(!WINDOWS)(
  "PowerShell pipe verifies and installs a release without leaking caller state",
  () => {
    const item = fixture();
    try {
      const result = item.run();
      expect(result.status).toBe(0);
      expect(readFileSync(item.sentinel, "utf8")).toContain(
        "extracted\\Astra-win32-x64",
      );
      expect(item.requests()).toEqual([
        "https://api.github.com/repos/witong42/Astra/releases/latest",
        `https://github.com/witong42/Astra/releases/download/v${VERSION}/${ARCHIVE}`,
        `https://github.com/witong42/Astra/releases/download/v${VERSION}/${ARCHIVE}.sha256`,
      ]);
      item.verifyPreserved();
    } finally {
      item.close();
    }
  },
  TIMEOUT,
);

for (const [scenario, error] of [
  ["corrupt download", "checksum verification"],
  ["wrong checksum name", "checksum verification"],
  ["unsafe path", "unexpected path"],
  ["missing installer", "missing Install.ps1"],
  ["invalid tag", "No stable Astra release"],
  ["running app", "Quit Astra"],
  ["installer failure", "exit 7"],
] as const)
  test.skipIf(!WINDOWS)(
    `Windows bootstrap rejects ${scenario} and cleans its temporary download`,
    () => {
      const item = fixture(scenario);
      try {
        const result = item.run();
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(error);
        expect(existsSync(item.sentinel)).toBe(false);
        if (scenario === "running app") expect(item.requests()).toEqual([]);
        if (scenario === "invalid tag") expect(item.requests()).toHaveLength(1);
        item.verifyPreserved();
      } finally {
        item.close();
      }
    },
    TIMEOUT,
  );
