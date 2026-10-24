import { expect, test } from "bun:test";
import { join } from "node:path";

const project = join(import.meta.dir, "..");
const BUILD_TIMEOUT_MS = 15_000;

test.each([
  [undefined, "Set ASTRA_REMOTE_URL"],
  ["", "Set ASTRA_REMOTE_URL"],
  ["http://example.com", "one exact HTTPS origin"],
  ["https://example.com/path", "one exact HTTPS origin"],
  ["https://user:password@example.com", "one exact HTTPS origin"],
])(
  "web builds reject an unconfigured or unsafe backend: %s",
  (remote, message) => {
    const env = { ...process.env };
    if (remote === undefined) delete env.ASTRA_REMOTE_URL;
    else env.ASTRA_REMOTE_URL = remote;
    const result = Bun.spawnSync([process.execPath, "scripts/build-web.ts"], {
      cwd: project,
      env,
      timeout: BUILD_TIMEOUT_MS,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain(message);
  },
);

test.each(["https://astra-backend.example.com", "http://127.0.0.1:4319"])(
  "web builds embed the configured backend: %s",
  async (remote) => {
    const result = Bun.spawnSync([process.execPath, "scripts/build-web.ts"], {
      cwd: project,
      env: { ...process.env, ASTRA_REMOTE_URL: remote },
      timeout: BUILD_TIMEOUT_MS,
    });
    expect(result.exitCode).toBe(0);
    expect(
      await Bun.file(join(project, "dist/client/web.js")).text(),
    ).toContain(remote);
    expect(
      await Bun.file(join(project, "dist/client/index.html")).text(),
    ).toContain(`connect-src ${remote}`);
  },
);
