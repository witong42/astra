type Target = { id: string; url: string; webSocketDebuggerUrl: string };
type Response = {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message: string };
  method?: string;
  params?: Record<string, unknown>;
};

export async function showWorkspace(
  client: Awaited<ReturnType<typeof desktopClient>>,
  chat = false,
) {
  const id = await client.evaluate<string>(
    "window.codexos.snapshot().then(state=>state.activeId)",
  );
  let opened = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const ready = await client.evaluate<boolean>(
      `(()=>{const id=${JSON.stringify(id)}; if(document.querySelector('.home-screen')) {const button=document.querySelector('.library-open[data-workspace-id="'+id+'"]');button?.click();return false;} return document.querySelector('.app-stage')?.dataset.workspaceId===id;})()`,
    );
    if (ready) {
      opened = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!opened) throw new Error("The workspace did not open from Home.");
  if (chat) {
    await client.evaluate(
      "if(document.querySelector('.chat-drawer').inert) document.getElementById('chat-toggle').click()",
    );
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        await client.evaluate("!document.querySelector('.chat-drawer').inert")
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("The chat drawer did not open.");
  }
}

export async function desktopClient(
  surface: "app" | "canvas" = "app",
  workspaceId?: string,
) {
  const targets = (await (
    await fetch("http://127.0.0.1:9337/json/list")
  ).json()) as Target[];
  const candidates = targets.filter(
    (entry) =>
      entry.url.endsWith(
        surface === "app" ? "/dist/index.html" : "/dist/canvas.html",
      ) &&
      (entry.url.includes("/Projects/CodexOS/") ||
        entry.url.startsWith("file:///Applications/CodexOS.app/") ||
        entry.url.startsWith("file:///Applications/Astra.app/")),
  );
  if (surface === "canvas") {
    const app = await desktopClient("app");
    let selected = workspaceId;
    try {
      selected ??= await app.evaluate<string>(
        "document.querySelector('.generated-surface:not(.background-surface) .canvas-frame')?.name ?? document.querySelector('.canvas-frame')?.name",
      );
    } finally {
      app.close();
    }
    for (const target of candidates) {
      const client = await connectTarget(target);
      if ((await client.evaluate<string>("window.name")) === selected)
        return client;
      client.close();
    }
    throw new Error(
      `No live canvas exists for workspace ${selected}. Select it or wait for its frame to load.`,
    );
  }
  if (!candidates[0])
    throw new Error(
      "Open the CodexOS test build with --remote-debugging-port=9337 first.",
    );
  return connectTarget(candidates[0]);
}

async function connectTarget(target: Target) {
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
