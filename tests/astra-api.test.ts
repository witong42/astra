import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { astraSocketPath, requestAstra, startAstraApi } from "../src/astra-api";

async function withApi(
  check: (directory: string, path: string, calls: unknown[]) => Promise<void>,
) {
  const directory = mkdtempSync(join(tmpdir(), "astra-api-test-"));
  const path = astraSocketPath(directory);
  const calls: unknown[] = [];
  const server = await startAstraApi(path, async (request) => {
    calls.push(request);
    const action = (request as { action: string }).action;
    if (action === "fail") throw new Error("The app rejected this action.");
    if (action === "list") return [{ id: "moon-id", name: "Lune Bleue" }];
    return { confirmed: request };
  });
  try {
    await check(directory, path, calls);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
}

test("local Astra API confirms actions, returns errors and protects its socket", () =>
  withApi(async (_, path, calls) => {
    expect(await requestAstra({ action: "home" }, path)).toEqual({
      confirmed: { action: "home" },
    });
    await expect(requestAstra({ action: "fail" }, path)).rejects.toThrow(
      "app rejected",
    );
    if (process.platform !== "win32")
      expect(statSync(path).mode & 0o777).toBe(0o600);
    await expect(startAstraApi(path, async () => null)).rejects.toThrow(
      "already running",
    );
    expect(await requestAstra({ action: "status" }, path)).toEqual({
      confirmed: { action: "status" },
    });
    expect(calls).toHaveLength(3);
  }));

test("malformed and fragmented requests cannot bypass the JSON command boundary", () =>
  withApi(async (_, path, calls) => {
    async function raw(chunks: string[]) {
      const socket = connect(path);
      let output = "";
      socket.on("data", (chunk) => {
        output += chunk.toString();
      });
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });
      for (const chunk of chunks) socket.write(chunk);
      await new Promise<void>((resolve) => socket.once("end", resolve));
      return JSON.parse(output);
    }
    expect((await raw(["not JSON\n"])).ok).toBe(false);
    expect(calls).toHaveLength(0);
    expect(
      (await raw(['{"action":"fill","value":"é', 'toile"}\n'])).result,
    ).toEqual({ confirmed: { action: "fill", value: "étoile" } });
  }));

test("the astra CLI resolves app names, passes values as data and reports failures", () =>
  withApi(async (directory, _, calls) => {
    async function cli(args: string[]) {
      const process = Bun.spawn(
        ["bun", join(import.meta.dir, "../src/astra-cli.ts"), ...args],
        {
          env: { ...Bun.env, CODEXOS_DATA_DIR: directory },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [stdout, stderr, code] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
        process.exited,
      ]);
      return { stdout, stderr, code };
    }
    const help = await cli(["--help"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("astra apps open");
    expect(calls).toHaveLength(0);
    const opened = await cli(["apps", "open", "lune bleue"]);
    expect(opened.code).toBe(0);
    expect(JSON.parse(opened.stdout)).toEqual({
      confirmed: { action: "open", id: "moon-id" },
    });
    const value = '$(whoami) `echo test` "étoile"';
    expect((await cli(["apps", "fill", "moon-id", "#title", value])).code).toBe(
      0,
    );
    expect(calls.at(-1)).toEqual({
      action: "fill",
      id: "moon-id",
      selector: "#title",
      value,
    });
    const missing = await cli(["apps", "open", "missing"]);
    expect(missing.code).toBe(1);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toContain("App not found");
  }));

test("offline Astra gives an actionable CLI error and never removes regular files", async () => {
  const directory = mkdtempSync(join(tmpdir(), "astra-api-offline-"));
  const path = astraSocketPath(directory);
  try {
    await expect(requestAstra({ action: "status" }, path)).rejects.toThrow(
      "Open the Astra desktop app",
    );
    if (process.platform !== "win32") {
      writeFileSync(path, "keep");
      await expect(startAstraApi(path, async () => null)).rejects.toThrow(
        "regular file",
      );
      expect(await Bun.file(path).text()).toBe("keep");
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
