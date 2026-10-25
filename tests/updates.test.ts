import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
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
import {
  launchUpdateInstaller,
  prepareUpdateInstall,
} from "../src/update-install";
import { AppUpdates, selectUpdate, type UpdateState } from "../src/updates";

const REPOSITORY = "https://github.com/witong42/astra";
const API = "https://api.github.com/repos/witong42/astra/releases/latest";
const ARCHIVE = "Astra-macos-arm64.zip";
const VERSION = "0.6.0";
const CONTENT = new TextEncoder().encode("complete verified Astra package");
const DIGEST = createHash("sha256").update(CONTENT).digest("hex");
const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function release(name = ARCHIVE) {
  return {
    tag_name: `v${VERSION}`,
    draft: false,
    prerelease: false,
    assets: [
      {
        name,
        size: CONTENT.length,
        digest: `sha256:${DIGEST}`,
        browser_download_url: `${REPOSITORY}/releases/download/v${VERSION}/${name}`,
      },
      {
        name: `${name}.sha256`,
        size: 100,
        browser_download_url: `${REPOSITORY}/releases/download/v${VERSION}/${name}.sha256`,
      },
    ],
  };
}

function fixture(
  options: {
    body?: Uint8Array<ArrayBuffer>;
    checksum?: string;
    metadata?: unknown;
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "astra-update-test-"));
  temporary.push(directory);
  const personal = join(directory, "workspace.json");
  writeFileSync(personal, "existing personal apps");
  const cache = join(directory, "cache");
  const states: UpdateState[] = [];
  const requests: string[] = [];
  const updater = new AppUpdates({
    version: "0.5.1",
    platform: "darwin",
    architecture: "arm64",
    cacheDirectory: cache,
    onChange: (state) => states.push(state),
    fetcher: async (url) => {
      requests.push(url);
      if (url === API) return Response.json(options.metadata ?? release());
      if (url.endsWith(".sha256"))
        return new Response(options.checksum ?? `${DIGEST}  ${ARCHIVE}\n`);
      return new Response(options.body ?? CONTENT);
    },
  });
  return { updater, requests, states, cache, personal };
}

test.each([
  ["darwin", "arm64", ARCHIVE],
  ["win32", "x64", "Astra-0.6.0-windows-x64.zip"],
  ["linux", "x64", "Astra-0.6.0-linux-x64.deb"],
  ["linux", "arm64", "Astra-0.6.0-linux-arm64.deb"],
] as const)(
  "stable updates choose the exact %s %s package",
  (platform, architecture, archive) => {
    expect(
      selectUpdate(release(archive), "0.5.1", platform, architecture),
    ).toMatchObject({
      version: VERSION,
      name: archive,
      bytes: CONTENT.length,
      digest: DIGEST,
    });
  },
);

test("updates never downgrade, install prereleases, or accept another repository's asset", () => {
  expect(selectUpdate(release(), VERSION, "darwin", "arm64")).toBeNull();
  expect(selectUpdate(release(), "0.10.0", "darwin", "arm64")).toBeNull();
  expect(
    selectUpdate(
      { ...release(), prerelease: true },
      "0.5.1",
      "darwin",
      "arm64",
    ),
  ).toBeNull();
  expect(
    selectUpdate({ ...release(), draft: true }, "0.5.1", "darwin", "arm64"),
  ).toBeNull();
  const foreign = release();
  foreign.assets[0].browser_download_url = `https://github.com/another/project/releases/download/v0.6.0/${ARCHIVE}`;
  expect(() => selectUpdate(foreign, "0.5.1", "darwin", "arm64")).toThrow(
    "URL",
  );
  expect(() => selectUpdate(release(), "0.5.1", "darwin", "x64")).toThrow(
    "supported",
  );
});

test("one concurrent update check downloads and verifies one complete archive", async () => {
  const f = fixture();
  await Promise.all([f.updater.check(), f.updater.check()]);
  expect(f.requests).toHaveLength(3);
  expect(f.updater.snapshot()).toMatchObject({
    status: "ready",
    version: VERSION,
  });
  const prepared = f.updater.prepared();
  expect(readFileSync(prepared.archive)).toEqual(Buffer.from(CONTENT));
  expect(readFileSync(`${prepared.archive}.sha256`, "utf8")).toBe(
    `${DIGEST}  ${ARCHIVE}\n`,
  );
  expect(f.states.some((state) => state.status === "downloading")).toBe(true);
  expect(readFileSync(f.personal, "utf8")).toBe("existing personal apps");
  await f.updater.dispose();
  expect(existsSync(prepared.directory)).toBe(false);
  expect(existsSync(f.personal)).toBe(true);
});

test.each([
  { body: Uint8Array.from(CONTENT, (byte) => byte ^ 1), error: "checksum" },
  { body: CONTENT.subarray(1), error: "size" },
  { checksum: `${DIGEST}  another.zip\n`, error: "checksum" },
  { checksum: `${"0".repeat(64)}  ${ARCHIVE}\n`, error: "checksum" },
])(
  "a damaged update cannot become installable ($error)",
  async ({ error, ...options }) => {
    const f = fixture(options);
    await expect(f.updater.check()).rejects.toThrow(error);
    expect(f.updater.snapshot().status).toBe("error");
    expect(() => f.updater.prepared()).toThrow("ready");
    expect(existsSync(f.cache) ? readdirSync(f.cache) : []).toEqual([]);
    expect(readFileSync(f.personal, "utf8")).toBe("existing personal apps");
  },
);

test("a current version performs no archive download and remains usable offline", async () => {
  const f = fixture({ metadata: { ...release(), tag_name: "v0.5.1" } });
  await f.updater.check();
  expect(f.requests).toEqual([API]);
  expect(f.updater.snapshot().status).toBe("current");
  expect(() => f.updater.prepared()).toThrow("ready");
});

test("installation retains its verified files when the old app shuts down", async () => {
  const f = fixture();
  await f.updater.check();
  const prepared = f.updater.prepared();
  f.updater.installing();
  await f.updater.dispose();
  expect(existsSync(prepared.archive)).toBe(true);
  expect(f.updater.snapshot().status).toBe("installing");
});

test("a failed installation clears its retained files and allows a fresh verified download", async () => {
  const f = fixture();
  await f.updater.check();
  const prepared = f.updater.prepared();
  f.updater.installing();
  const error = await f.updater.installationFailed(
    new Error("Installer could not start"),
  );
  expect(error.message).toContain("could not start");
  expect(f.updater.snapshot().status).toBe("error");
  expect(existsSync(prepared.directory)).toBe(false);
  await f.updater.check();
  expect(f.updater.snapshot().status).toBe("ready");
  expect(f.requests).toHaveLength(6);
  await f.updater.dispose();
});

test.skipIf(process.platform !== "darwin" || process.getuid?.() === 0)(
  "an app running from a read-only installation is rejected before it can quit",
  async () => {
    const f = fixture();
    await f.updater.check();
    const applications = join(f.cache, "Applications");
    const appPath = join(applications, "Astra.app/Contents/Resources/app");
    mkdirSync(join(appPath, "dist"), { recursive: true });
    writeFileSync(join(appPath, "dist/install.sh"), "verified installer");
    try {
      chmodSync(applications, 0o555);
      await expect(
        prepareUpdateInstall(f.updater.prepared(), {
          cacheDirectory: f.cache,
          appPath,
          executable: process.execPath,
          platform: "darwin",
          parentPid: process.pid,
        }),
      ).rejects.toThrow("not writable");
    } finally {
      chmodSync(applications, 0o755);
      await f.updater.dispose();
    }
  },
);

test("network failure reports an error and a later check can recover", async () => {
  let online = false;
  const f = fixture();
  const updater = new AppUpdates({
    version: "0.5.1",
    platform: "darwin",
    architecture: "arm64",
    cacheDirectory: f.cache,
    fetcher: async (url) => {
      if (!online) return new Response("offline", { status: 503 });
      if (url === API) return Response.json(release());
      return new Response(
        url.endsWith(".sha256") ? `${DIGEST}  ${ARCHIVE}\n` : CONTENT,
      );
    },
    onChange() {},
  });
  await expect(updater.check()).rejects.toThrow("503");
  online = true;
  await updater.check();
  expect(updater.snapshot().status).toBe("ready");
  await updater.dispose();
});

test("removing the download cache during a network failure cannot leave updates stuck checking", async () => {
  const f = fixture();
  let evict = true;
  const updater = new AppUpdates({
    version: "0.5.1",
    platform: "darwin",
    architecture: "arm64",
    cacheDirectory: f.cache,
    onChange() {},
    fetcher: async (url) => {
      if (url === API) return Response.json(release());
      if (url.endsWith(".sha256"))
        return new Response(`${DIGEST}  ${ARCHIVE}\n`);
      if (evict) {
        const directory = readdirSync(f.cache).find((name) =>
          name.startsWith("download-"),
        );
        if (!directory) throw new Error("Missing test download directory");
        rmSync(join(f.cache, directory), { recursive: true });
        throw new Error("Connection lost after cache removal");
      }
      return new Response(CONTENT);
    },
  });
  await expect(updater.check()).rejects.toThrow("Connection lost");
  expect(updater.snapshot().status).toBe("error");
  evict = false;
  await updater.check();
  expect(updater.snapshot().status).toBe("ready");
  await updater.dispose();
  expect(readdirSync(f.cache)).toEqual([]);
  expect(readFileSync(f.personal, "utf8")).toBe("existing personal apps");
});

test.skipIf(process.platform !== "darwin")(
  "the update installer waits for graceful shutdown and survives the old app exiting",
  async () => {
    const f = fixture();
    await f.updater.check();
    const prepared = f.updater.prepared();
    const appPath = join(f.cache, "Astra.app/Contents/Resources/app");
    mkdirSync(join(appPath, "dist"), { recursive: true });
    const marker = join(f.cache, "installed-version");
    const markerDelaySeconds = 0.1;
    writeFileSync(
      join(appPath, "dist/install.sh"),
      `#!/bin/bash\nset -eu\n: > "$ASTRA_UPDATE_TEST_MARKER"\nsleep ${markerDelaySeconds}\nprintf "%s" "$ASTRA_UPDATE_VERSION" > "$ASTRA_UPDATE_TEST_MARKER"\n`,
    );
    const parent = Bun.spawn(
      [process.execPath, "-e", "setTimeout(()=>{},1500)"],
      { stdout: "ignore", stderr: "ignore" },
    );
    try {
      const installation = await prepareUpdateInstall(prepared, {
        cacheDirectory: f.cache,
        appPath,
        executable: process.execPath,
        platform: "darwin",
        parentPid: parent.pid,
      });
      installation.environment.ASTRA_NO_OPEN = "1";
      installation.environment.ASTRA_UPDATE_TEST_MARKER = marker;
      await launchUpdateInstaller(installation);
      expect(existsSync(marker)).toBe(false);
      f.updater.installing();
      await f.updater.dispose();
      await parent.exited;
      const deadline = Date.now() + 3000;
      const installed = () =>
        existsSync(marker) && readFileSync(marker, "utf8") === "v0.6.0";
      while (!installed() && Date.now() < deadline) await Bun.sleep(25);
      expect(readFileSync(marker, "utf8")).toBe("v0.6.0");
    } finally {
      parent.kill();
    }
  },
  10_000,
);

test("a modified cached archive is rejected before an installer can be prepared", async () => {
  const f = fixture();
  await f.updater.check();
  const prepared = f.updater.prepared();
  writeFileSync(prepared.archive, "changed after download");
  await expect(
    prepareUpdateInstall(prepared, {
      cacheDirectory: f.cache,
      appPath: f.cache,
      executable: process.execPath,
      platform: "darwin",
      parentPid: process.pid,
    }),
  ).rejects.toThrow("checksum changed");
  expect(existsSync(join(prepared.directory, "update.sh"))).toBe(false);
  await f.updater.dispose();
});

test.skipIf(process.platform !== "darwin")(
  "preparing an installation can be retried and never reuses a modified helper",
  async () => {
    const f = fixture();
    await f.updater.check();
    const prepared = f.updater.prepared();
    const appPath = join(f.cache, "Astra.app/Contents/Resources/app");
    mkdirSync(join(appPath, "dist"), { recursive: true });
    writeFileSync(join(appPath, "dist/install.sh"), "verified installer");
    const target = {
      cacheDirectory: f.cache,
      appPath,
      executable: process.execPath,
      platform: "darwin",
      parentPid: process.pid,
    };
    await prepareUpdateInstall(prepared, target);
    await prepareUpdateInstall(prepared, target);
    writeFileSync(join(prepared.directory, "update.sh"), "modified helper");
    await expect(prepareUpdateInstall(prepared, target)).rejects.toThrow(
      "helper changed",
    );
    await f.updater.dispose();
  },
);
