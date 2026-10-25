import { cpSync } from "node:fs";
import { join } from "node:path";

const EXCLUDED_BUILD_ENTRIES = ["client", "server", "website", "voice-helper"];

export function copyDesktopBuild(source: string, destination: string) {
  const excluded = EXCLUDED_BUILD_ENTRIES.map((name) => join(source, name));
  cpSync(source, destination, {
    recursive: true,
    filter: (path) => !excluded.includes(path),
  });
}
