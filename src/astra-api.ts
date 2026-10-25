import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, rmSync } from "node:fs";
import { connect, createServer } from "node:net";
import { join } from "node:path";
import { astraConfig } from "./config";

const MAX_FRAME_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const PROBE_TIMEOUT_MS = 500;
export function astraSocketPath(directory = astraConfig().dataDirectory) {
  return process.platform === "win32"
    ? `\\\\.\\pipe\\astra-${createHash("sha256").update(directory).digest("hex").slice(0, 16)}`
    : join(directory, "astra.sock");
}

export async function startAstraApi(
  path: string,
  execute: (request: unknown) => Promise<unknown>,
) {
  if (process.platform === "win32" || existsSync(path)) {
    if (process.platform !== "win32" && !lstatSync(path).isSocket())
      throw new Error("Astra's API socket path is occupied by a regular file.");
    const active = await new Promise<boolean>((resolve, reject) => {
      const probe = connect(path);
      probe.setTimeout(PROBE_TIMEOUT_MS, () => {
        probe.destroy();
        reject(new Error("Astra's existing API did not respond."));
      });
      probe.once("connect", () => {
        probe.destroy();
        resolve(true);
      });
      probe.once("error", (error: NodeJS.ErrnoException) =>
        error.code === "ECONNREFUSED" || error.code === "ENOENT"
          ? resolve(false)
          : reject(error),
      );
    });
    if (active) throw new Error("Astra's API is already running.");
    if (process.platform !== "win32") rmSync(path, { force: true });
  }
  const server = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let handled = false;
    socket.on("error", () => socket.destroy());
    socket.setTimeout(REQUEST_TIMEOUT_MS, () => socket.destroy());
    socket.on("data", (chunk) => {
      if (handled) return;
      buffer = Buffer.concat([buffer, chunk]);
      const reply = (value: unknown) => {
        if (!socket.destroyed) socket.end(`${JSON.stringify(value)}\n`);
      };
      if (buffer.length > MAX_FRAME_BYTES) {
        handled = true;
        reply({ ok: false, error: "Astra request exceeds 4 MB." });
        return;
      }
      const newline = buffer.indexOf(10);
      if (newline === -1) return;
      handled = true;
      void Promise.resolve()
        .then(() =>
          execute(JSON.parse(buffer.subarray(0, newline).toString("utf8"))),
        )
        .then(
          (result) => reply({ ok: true, result }),
          (error) =>
            reply({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            }),
        );
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  if (process.platform !== "win32") chmodSync(path, 0o600);
  return server;
}

export function requestAstra(
  request: unknown,
  path = astraSocketPath(),
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = connect(path);
    let buffer = Buffer.alloc(0);
    let finished = false;
    const fail = (error: Error) => {
      finished = true;
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(REQUEST_TIMEOUT_MS, () =>
      fail(new Error("Astra did not confirm the action within 15 seconds.")),
    );
    socket.once("error", (error: NodeJS.ErrnoException) =>
      fail(
        error.code === "ENOENT" || error.code === "ECONNREFUSED"
          ? new Error("Astra is not running. Open the Astra desktop app first.")
          : error,
      ),
    );
    socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_FRAME_BYTES) {
        fail(new Error("Astra returned an oversized response."));
        return;
      }
      const newline = buffer.indexOf(10);
      if (newline === -1) return;
      try {
        const response = JSON.parse(
          buffer.subarray(0, newline).toString("utf8"),
        );
        if (response?.ok === true && "result" in response) {
          finished = true;
          socket.destroy();
          resolve(response.result);
        } else if (response?.ok === false && typeof response.error === "string")
          fail(new Error(response.error));
        else fail(new Error("Astra returned an invalid API response."));
      } catch {
        fail(new Error("Astra returned an invalid API response."));
      }
    });
    socket.once("end", () => {
      if (!finished)
        fail(
          new Error(
            "Astra closed the connection without confirming the action.",
          ),
        );
    });
  });
}
