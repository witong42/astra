import { cpSync } from "node:fs";
import { join } from "node:path";

const WEB_BUILD_DIRECTORIES = ["client", "server", "website"];

export function copyDesktopBuild(source: string, destination: string) {
  const webOutputs = WEB_BUILD_DIRECTORIES.map((name) => join(source, name));
  cpSync(source, destination, {
    recursive: true,
    filter: (path) => !webOutputs.includes(path),
  });
}
