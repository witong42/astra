import { expect, spyOn, test } from "bun:test";
import { desktopClient } from "../scripts/desktop-client";

test("desktop checks connect to the renamed Astra project", async () => {
  const socketUrl = "ws://127.0.0.1:9337/devtools/page/astra";
  const fetch = spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json([
      {
        id: "astra",
        url: new URL("../dist/index.html", import.meta.url).href,
        webSocketDebuggerUrl: socketUrl,
      },
    ]),
  );
  const original = globalThis.WebSocket;
  let connected = "";
  let closed = false;
  class Socket {
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    constructor(url: string) {
      connected = url;
      queueMicrotask(() => this.onopen?.());
    }
    send(data: string) {
      const message = JSON.parse(data);
      expect(message.method).toBe("Runtime.enable");
      this.onmessage?.({
        data: JSON.stringify({ id: message.id, result: {} }),
      });
    }
    close() {
      closed = true;
    }
  }
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  try {
    const client = await desktopClient();
    expect(connected).toBe(socketUrl);
    client.close();
    expect(closed).toBe(true);
  } finally {
    globalThis.WebSocket = original;
    fetch.mockRestore();
  }
});
