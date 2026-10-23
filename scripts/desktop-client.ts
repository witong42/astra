type Target = { url: string; webSocketDebuggerUrl: string };
type Response = {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message: string };
  method?: string;
  params?: Record<string, unknown>;
};

export async function desktopClient(surface: "app" | "canvas" = "app") {
  const targets = (await (
    await fetch("http://127.0.0.1:9337/json/list")
  ).json()) as Target[];
  const target = targets.find(
    (entry) =>
      entry.url.endsWith(
        surface === "app" ? "/dist/index.html" : "/dist/canvas.html",
      ) &&
      (entry.url.includes("/Projects/CodexOS/") ||
        entry.url.startsWith("file:///Applications/CodexOS.app/")),
  );
  if (!target)
    throw new Error(
      "Open the CodexOS test build with --remote-debugging-port=9337 first.",
    );
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("Cannot connect to CodexOS"));
  });
  let nextId = 0;
  const pending = new Map<
    number,
    {
      resolve: (value: Record<string, unknown>) => void;
      reject: (error: Error) => void;
    }
  >();
  const errors: unknown[] = [];
  ws.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as Response;
    if (message.method === "Runtime.exceptionThrown")
      errors.push(message.params);
    if (message.id !== undefined) {
      const call = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) call?.reject(new Error(message.error.message));
      else call?.resolve(message.result ?? {});
    }
  };
  const call = (method: string, params: unknown = {}) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  await call("Runtime.enable");
  return {
    call,
    errors,
    evaluate: async <T = unknown>(expression: string): Promise<T> => {
      const result = await call("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
      });
      if (result.exceptionDetails)
        throw new Error(JSON.stringify(result.exceptionDetails));
      return (result.result as { value: T }).value;
    },
    screenshot: async (path: string) => {
      const result = await call("Page.captureScreenshot", { format: "png" });
      await Bun.write(path, Buffer.from(String(result.data), "base64"));
    },
    close: () => ws.close(),
  };
}
