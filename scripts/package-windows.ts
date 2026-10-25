import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { copyDesktopBuild } from "./package-files";

const RCEDIT_VERSION = "2.0.0";
const RCEDIT_SHA256 =
  "3e7801db1a5edbec91b49a24a094aad776cb4515488ea5a4ca2289c400eade2a";

export async function packageWindows(
  root: string,
  release: string,
  source: { version: string; astraBuild: number },
) {
  if (process.arch !== "x64")
    throw new Error(
      "Package Windows with x64 Bun. Native Windows ARM64 voice assets are not built yet.",
    );
  const output = join(release, "Astra-win32-x64");
  if (existsSync(output))
    throw new Error(
      `${output} already exists. Increase the release version before packaging again.`,
    );
  for (const file of [
    "dist/main.cjs",
    "dist/astra.cjs",
    "dist/preload.cjs",
    "dist/renderer.js",
    "dist/voice/libvosk.dll",
    "dist/voice/libwinpthread-1.dll",
    "dist/voice/vosk-model-small-en-us-0.15/am/final.mdl",
    "node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node",
  ])
    if (!existsSync(join(root, file)))
      throw new Error(
        `Windows package is missing ${file}. Run the Windows build first.`,
      );
  mkdirSync(release, { recursive: true });
  cpSync(join(root, "node_modules/electron/dist"), output, { recursive: true });
  renameSync(join(output, "electron.exe"), join(output, "Astra.exe"));
  if (existsSync(join(output, "electron_wer.dll")))
    renameSync(join(output, "electron_wer.dll"), join(output, "Astra_wer.dll"));
  const app = join(output, "resources/app");
  mkdirSync(app, { recursive: true });
  copyDesktopBuild(join(root, "dist"), join(app, "dist"));
  for (const name of ["koffi", "@koromix/koffi-win32-x64"])
    cpSync(join(root, "node_modules", name), join(app, "node_modules", name), {
      recursive: true,
      dereference: true,
    });
  for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md"])
    cpSync(join(root, file), join(app, file));
  writeFileSync(
    join(app, "package.json"),
    JSON.stringify({
      name: "astra",
      productName: "Astra",
      version: source.version,
      astraBuild: source.astraBuild,
      main: "dist/main.cjs",
    }),
  );
  const tools = join(root, "node_modules/.cache/astra-package");
  mkdirSync(tools, { recursive: true });
  const rcedit = join(tools, "rcedit-x64.exe");
  if (!existsSync(rcedit)) {
    const response = await fetch(
      `https://github.com/electron/rcedit/releases/download/v${RCEDIT_VERSION}/rcedit-x64.exe`,
    );
    if (!response.ok)
      throw new Error(
        `Windows resource tool download failed (${response.status}).`,
      );
    writeFileSync(rcedit, new Uint8Array(await response.arrayBuffer()));
  }
  if (
    createHash("sha256").update(readFileSync(rcedit)).digest("hex") !==
    RCEDIT_SHA256
  )
    throw new Error("Windows resource tool checksum mismatch.");
  const icon = join(app, "dist/icon.ico");
  const iconScript = `
Add-Type -AssemblyName System.Drawing
$source = [Drawing.Image]::FromFile($args[0])
$bitmap = [Drawing.Bitmap]::new(256,256)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$graphics.DrawImage($source,0,0,256,256)
$png = [IO.MemoryStream]::new()
$bitmap.Save($png,[Drawing.Imaging.ImageFormat]::Png)
$writer = [IO.BinaryWriter]::new([IO.File]::Create($args[1]))
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
$writer.Write([byte[]]@(0,0,0,0)); $writer.Write([uint16]1); $writer.Write([uint16]32)
$writer.Write([uint32]$png.Length); $writer.Write([uint32]22); $writer.Write($png.ToArray())
$writer.Dispose(); $png.Dispose(); $graphics.Dispose(); $bitmap.Dispose(); $source.Dispose()
`;
  const encodedArgs = Buffer.from(
    JSON.stringify([join(app, "dist/icon.png"), icon]),
  ).toString("base64");
  const bootstrap = `$ErrorActionPreference='Stop'; $values=([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedArgs}')) | ConvertFrom-Json); & {${iconScript}} @values`;
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(bootstrap, "utf16le").toString("base64"),
    ],
    { stdio: "inherit" },
  );
  execFileSync(
    rcedit,
    [
      join(output, "Astra.exe"),
      "--set-icon",
      icon,
      "--set-version-string",
      "ProductName",
      "Astra",
      "--set-version-string",
      "FileDescription",
      "Astra",
      "--set-version-string",
      "OriginalFilename",
      "Astra.exe",
      "--set-version-string",
      "CompanyName",
      "Halcytron",
      "--set-file-version",
      `${source.version}.${source.astraBuild}`,
      "--set-product-version",
      source.version,
    ],
    { stdio: "inherit" },
  );
  const installer = windowsInstaller(source.version);
  writeFileSync(join(output, "Install.ps1"), `\uFEFF${installer}`);
  writeFileSync(
    join(output, "Install.cmd"),
    '@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install.ps1"\r\nif errorlevel 1 pause\r\n',
  );
  const files: { path: string; sha256: string }[] = [];
  function inventory(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) inventory(path);
      else
        files.push({
          path: relative(output, path).replaceAll("\\", "/"),
          sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
        });
    }
  }
  inventory(output);
  writeFileSync(
    join(output, "app-manifest.json"),
    JSON.stringify({
      version: source.version,
      build: source.astraBuild,
      files,
    }),
  );
  const archive = join(release, `Astra-${source.version}-windows-x64.zip`);
  const zipCommand = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Compress-Archive -LiteralPath '${output.replaceAll("'", "''")}' -DestinationPath '${archive.replaceAll("'", "''")}'`;
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(zipCommand, "utf16le").toString("base64"),
    ],
    { stdio: "inherit" },
  );
  writeFileSync(
    `${archive}.sha256`,
    `${createHash("sha256").update(readFileSync(archive)).digest("hex")}  ${archive.split(/[\\/]/).at(-1)}\n`,
  );
  console.log(archive);
}

export function windowsInstaller(version: string) {
  return `param([switch]$NoLaunch)
$ErrorActionPreference='Stop'
$installRoot=Join-Path $env:LOCALAPPDATA 'Programs\\Astra'
$destination=Join-Path $installRoot '${version}'
if ((Get-Process Astra -ErrorAction SilentlyContinue | Where-Object {$_.Path -like "$installRoot\\*"})) {throw 'Quit Astra before installing this version.'}
$manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'app-manifest.json') -Raw | ConvertFrom-Json
function Test-AppFiles($directory) {
  foreach ($file in $manifest.files) {
    $path=Join-Path $directory $file.path
    if (!(Test-Path -LiteralPath $path) -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) {throw "Astra file verification failed: $($file.path). Extract the complete release again."}
  }
}
Test-AppFiles $PSScriptRoot
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Get-ChildItem -LiteralPath $PSScriptRoot | Copy-Item -Destination $destination -Recurse -Force
Test-AppFiles $destination
$bin=Join-Path $env:USERPROFILE '.local\\bin'
New-Item -ItemType Directory -Path $bin -Force | Out-Null
$cli='@echo off' + "\r\n" + 'setlocal' + "\r\n" + 'set ELECTRON_RUN_AS_NODE=1' + "\r\n" + '"%LOCALAPPDATA%\\Programs\\Astra\\${version}\\Astra.exe" "%LOCALAPPDATA%\\Programs\\Astra\\${version}\\resources\\app\\dist\\astra.cjs" %*' + "\r\n" + 'exit /b %errorlevel%' + "\r\n"
[IO.File]::WriteAllText((Join-Path $bin 'astra.cmd'),$cli,[Text.Encoding]::ASCII)
$shell=New-Object -ComObject WScript.Shell
$start=Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'
New-Item -ItemType Directory -Path $start -Force | Out-Null
$shortcut=$shell.CreateShortcut((Join-Path $start 'Astra.lnk'))
$shortcut.TargetPath=Join-Path $destination 'Astra.exe'
$shortcut.WorkingDirectory=$destination
$shortcut.IconLocation=$shortcut.TargetPath
$shortcut.Save()
if (!$NoLaunch) {Start-Process -FilePath $shortcut.TargetPath -WorkingDirectory $destination}
Write-Output "Installed Astra ${version} in $destination"
`;
}
