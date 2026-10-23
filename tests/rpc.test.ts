import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { RpcPeer } from "../src/rpc";

describe("Codex transport", () => {
  test("reports malformed server data so the app can offer reconnect", async () => {
    const input = new PassThrough();
    let disconnected = false;
    const peer = new RpcPeer(
      input,
      new PassThrough(),
      () => {},
      1000,
      () => {
        disconnected = true;
      },
    );
    const request = peer.request("thread/start", {});
    input.write("not JSON\n");
    await expect(request).rejects.toThrow("malformed JSON");
    expect(disconnected).toBe(true);
  });
  test("matches responses, accepts additive notifications and split UTF-8", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const events: unknown[] = [];
    const peer = new RpcPeer(input, output, (event) => events.push(event));
    const result = peer.request("account/read", {});
    const request = JSON.parse(output.read().toString());
    expect(request.method).toBe("account/read");
    const notification = Buffer.from(
      '{"method":"thread/readState/changed","params":{"title":"é"}}\n',
    );
    for (const byte of notification) input.write(Buffer.from([byte]));
    input.write(
      `${JSON.stringify({ id: request.id, result: { account: { type: "chatgpt" } } })}\n`,
    );
    expect(await result).toEqual({ account: { type: "chatgpt" } });
    expect(events).toEqual([
      { method: "thread/readState/changed", params: { title: "é" } },
    ]);
    peer.close();
  });

  test("rejects pending work when the backend exits", async () => {
    const peer = new RpcPeer(new PassThrough(), new PassThrough(), () => {});
    const result = peer.request("thread/start", {});
    peer.close(new Error("Codex exited"));
    expect(result).rejects.toThrow("Codex exited");
  });

  test("times out without retaining pending calls", async () => {
    const peer = new RpcPeer(
      new PassThrough(),
      new PassThrough(),
      () => {},
      10,
    );
    expect(peer.request("initialize", {})).rejects.toThrow("timed out");
    await Bun.sleep(25);
    peer.close();
  });
});
