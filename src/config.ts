import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

export function astraConfig(
  environment: Record<string, string | undefined> = process.env,
  homeDirectory = homedir(),
  platform = process.platform,
) {
  const profile = environment.ASTRA_DATA_DIR ?? environment.CODEXOS_DATA_DIR;
  const paths = platform === "win32" ? win32 : posix;
  let directory = paths.join(homeDirectory, "Library/Application Support");
  if (platform === "win32")
    directory =
      environment.APPDATA ?? paths.join(homeDirectory, "AppData", "Roaming");
  else if (platform === "linux") {
    const xdg = environment.XDG_CONFIG_HOME;
    directory =
      xdg && paths.isAbsolute(xdg) ? xdg : paths.join(homeDirectory, ".config");
  }
  const current = paths.join(directory, "Astra");
  const legacy = paths.join(directory, "CodexOS");
  const hasCurrentProfile =
    existsSync(paths.join(current, "workspace.json")) ||
    existsSync(paths.join(current, "astra.sock"));
  const hasLegacyProfile =
    existsSync(paths.join(legacy, "workspace.json")) ||
    existsSync(paths.join(legacy, "astra.sock"));
  return {
    dataDirectory:
      profile ?? (!hasCurrentProfile && hasLegacyProfile ? legacy : current),
    codexPath: environment.ASTRA_CODEX_PATH ?? environment.CODEXOS_CODEX_PATH,
    testHidden:
      (environment.ASTRA_TEST_HIDDEN ?? environment.CODEXOS_TEST_HIDDEN) ===
        "1" && Boolean(profile),
  };
}

export function codexEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory = homedir(),
  platform = process.platform,
) {
  const paths = platform === "win32" ? win32 : posix;
  const extra = [
    paths.join(homeDirectory, ".local", "bin"),
    paths.join(homeDirectory, ".bun", "bin"),
  ];
  if (platform === "darwin") extra.push("/opt/homebrew/bin");
  if (platform !== "win32") extra.push("/usr/local/bin", "/usr/bin", "/bin");
  return {
    ...environment,
    CODEX_HOME: environment.CODEX_HOME ?? paths.join(homeDirectory, ".codex"),
    PATH: [...extra, environment.PATH ?? environment.Path ?? ""].join(
      platform === "win32" ? ";" : ":",
    ),
  };
}
