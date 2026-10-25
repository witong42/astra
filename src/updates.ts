import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

const REPOSITORY = "https://github.com/witong42/astra";
const RELEASE_API =
  "https://api.github.com/repos/witong42/astra/releases/latest";
const REQUEST_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_CHECKSUM_BYTES = 1024;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const releaseSchema = z.object({
  tag_name: z.string().max(64),
  draft: z.boolean(),
  prerelease: z.boolean(),
  assets: z
    .array(
      z.object({
        name: z.string().max(200),
        size: z.number().int().positive().max(MAX_ARCHIVE_BYTES),
        digest: z.string().nullable().optional(),
        browser_download_url: z.string().max(2000),
      }),
    )
    .max(50),
});

export type UpdateState = {
  status:
    | "idle"
    | "checking"
    | "current"
    | "downloading"
    | "ready"
    | "installing"
    | "error";
  version?: string;
  percent?: number;
  error?: string;
};
export type UpdateRelease = {
  version: string;
  name: string;
  url: string;
  checksumUrl: string;
  bytes: number;
  digest?: string;
};
export type PreparedUpdate = {
  version: string;
  archive: string;
  directory: string;
  sha256: string;
  owner: string;
};
type Fetcher = (url: string, options?: RequestInit) => Promise<Response>;

function versionParts(version: string) {
  if (!VERSION_PATTERN.test(version))
    throw new Error("Invalid stable update version.");
  const parts = version.split(".").map(Number);
  if (!parts.every(Number.isSafeInteger))
    throw new Error("Invalid stable update version.");
  return parts;
}

export function selectUpdate(
  data: unknown,
  current: string,
  platform: string,
  architecture: string,
): UpdateRelease | null {
  let name: string;
  if (platform === "darwin" && architecture === "arm64")
    name = "Astra-macos-arm64.zip";
  else if (platform === "win32" && architecture === "x64") name = "windows";
  else if (
    platform === "linux" &&
    (architecture === "x64" || architecture === "arm64")
  )
    name = "linux";
  else
    throw new Error(
      "Automatic updates are not supported on this architecture.",
    );
  const parsed = releaseSchema.safeParse(data);
  if (!parsed.success)
    throw new Error("GitHub returned invalid update metadata.");
  const release = parsed.data;
  if (release.draft || release.prerelease) return null;
  if (!release.tag_name.startsWith("v"))
    throw new Error("Invalid stable update version.");
  const version = release.tag_name.slice(1);
  const next = versionParts(version);
  const previous = versionParts(current);
  const difference =
    next
      .map((value, index) => value - previous[index])
      .find((value) => value !== 0) ?? 0;
  if (difference <= 0) return null;
  if (name === "windows") name = `Astra-${version}-windows-x64.zip`;
  else if (name === "linux")
    name = `Astra-${version}-linux-${architecture}.deb`;
  const asset = release.assets.find((entry) => entry.name === name);
  const checksum = release.assets.find(
    (entry) => entry.name === `${name}.sha256`,
  );
  if (!asset || !checksum)
    throw new Error(
      "This release is missing the platform package or checksum.",
    );
  const url = `${REPOSITORY}/releases/download/${release.tag_name}/${name}`;
  if (
    asset.browser_download_url !== url ||
    checksum.browser_download_url !== `${url}.sha256`
  )
    throw new Error("The update asset URL is outside Astra's release.");
  let digest: string | undefined;
  if (asset.digest != null) {
    if (!/^sha256:[a-f0-9]{64}$/i.test(asset.digest))
      throw new Error("Invalid GitHub archive checksum.");
    digest = asset.digest.slice("sha256:".length).toLowerCase();
  }
  return {
    version,
    name,
    url,
    checksumUrl: `${url}.sha256`,
    bytes: asset.size,
    digest,
  };
}

async function limitedText(response: Response, limit: number) {
  if (!response.body) throw new Error("The update response was empty.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit)
        throw new Error("The update metadata exceeds its size limit.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

export class AppUpdates {
  private state: UpdateState = { status: "idle" };
  private pending: Promise<void> | null = null;
  private controller = new AbortController();
  private owned: { directory: string; root: string; token: string } | null =
    null;
  private download: PreparedUpdate | null = null;
  private retaining = false;

  constructor(
    private options: {
      version: string;
      platform: string;
      architecture: string;
      cacheDirectory: string;
      onChange: (state: UpdateState) => void;
      fetcher?: Fetcher;
    },
  ) {}

  snapshot(): UpdateState {
    return { ...this.state };
  }

  private change(state: UpdateState) {
    this.state = state;
    this.options.onChange(this.snapshot());
  }

  private async request(url: string, timeout = REQUEST_TIMEOUT_MS) {
    const response = await (this.options.fetcher ?? fetch)(url, {
      headers: {
        "User-Agent": "Astra-Updater",
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.any([
        this.controller.signal,
        AbortSignal.timeout(timeout),
      ]),
    });
    if (!response.ok)
      throw new Error(
        `Update download failed (HTTP ${response.status}). Check your connection and retry.`,
      );
    return response;
  }

  check(): Promise<void> {
    if (this.pending) return this.pending;
    if (this.state.status === "ready" || this.state.status === "installing")
      return Promise.resolve();
    this.pending = this.find()
      .catch(async (error: unknown) => {
        throw await this.failure(error);
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  private async find() {
    this.change({ status: "checking" });
    const response = await this.request(RELEASE_API);
    const metadata = JSON.parse(
      await limitedText(response, MAX_METADATA_BYTES),
    );
    const release = selectUpdate(
      metadata,
      this.options.version,
      this.options.platform,
      this.options.architecture,
    );
    if (!release) {
      this.change({ status: "current" });
      return;
    }
    const checksum = await limitedText(
      await this.request(release.checksumUrl),
      MAX_CHECKSUM_BYTES,
    );
    const match = /^([a-f\d]{64})[ \t]+\*?([^\r\n]+)\r?\n?$/i.exec(checksum);
    if (
      !match ||
      match[2] !== release.name ||
      (release.digest && match[1].toLowerCase() !== release.digest)
    )
      throw new Error(
        "The release checksum is invalid. Nothing was installed.",
      );
    const expected = match[1].toLowerCase();
    await mkdir(this.options.cacheDirectory, { recursive: true, mode: 0o700 });
    const root = await realpath(this.options.cacheDirectory);
    const directory = await mkdtemp(join(root, "download-"));
    const token = randomUUID();
    this.owned = { directory, root, token };
    await writeFile(join(directory, ".owner"), token, {
      mode: 0o600,
      flag: "wx",
    });
    const archive = join(directory, release.name);
    const download = await this.request(release.url, DOWNLOAD_TIMEOUT_MS);
    if (!download.body) throw new Error("The update archive was empty.");
    const reader = download.body.getReader();
    const file = await open(archive, "wx", 0o600);
    const hash = createHash("sha256");
    let received = 0;
    let percent = -1;
    this.change({
      status: "downloading",
      version: release.version,
      percent: 0,
    });
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (received > release.bytes)
          throw new Error("The update archive has an unexpected size.");
        hash.update(value);
        await file.writeFile(value);
        const progress = Math.floor((received / release.bytes) * 100);
        if (progress !== percent) {
          percent = progress;
          this.change({
            status: "downloading",
            version: release.version,
            percent,
          });
        }
      }
    } finally {
      await file.close();
      await reader.cancel();
      reader.releaseLock();
    }
    if (received !== release.bytes)
      throw new Error("The update archive has an unexpected size.");
    if (hash.digest("hex") !== expected)
      throw new Error(
        "The update checksum did not match. Nothing was installed.",
      );
    await writeFile(`${archive}.sha256`, `${expected}  ${release.name}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    this.download = {
      version: release.version,
      archive,
      directory,
      sha256: expected,
      owner: token,
    };
    this.change({ status: "ready", version: release.version, percent: 100 });
  }

  prepared(): PreparedUpdate {
    if (!this.download || this.state.status !== "ready")
      throw new Error("No verified update is ready.");
    return { ...this.download };
  }

  installing() {
    const prepared = this.prepared();
    this.retaining = true;
    this.change({ status: "installing", version: prepared.version });
  }

  async installationFailed(error: unknown) {
    this.retaining = false;
    return this.failure(error);
  }

  private async failure(error: unknown) {
    let failure = error instanceof Error ? error : new Error(String(error));
    try {
      await this.cleanup();
    } catch (cleanupError) {
      failure = new Error(
        `${failure.message} Update cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
        { cause: failure },
      );
    }
    this.change({ status: "error", error: failure.message });
    return failure;
  }

  private async cleanup() {
    const owned = this.owned;
    if (!owned) return;
    let directory: string;
    try {
      directory = await realpath(owned.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.owned = null;
      this.download = null;
      return;
    }
    if (
      dirname(owned.directory) !== owned.root ||
      directory !== owned.directory ||
      (await readFile(join(owned.directory, ".owner"), "utf8")) !== owned.token
    )
      throw new Error("Refusing to remove an unrecognized update directory.");
    await rm(owned.directory, { recursive: true });
    this.owned = null;
    this.download = null;
  }

  async dispose() {
    this.controller.abort();
    const pending = this.pending;
    if (pending) await Promise.allSettled([pending]);
    if (!this.retaining) await this.cleanup();
  }
}
