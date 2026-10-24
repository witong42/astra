#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { requestAstra } from "./astra-api";

const HELP = `Astra — control your running desktop app

astra status
astra home
astra apps list
astra apps open|read|inspect <app name or id>
astra apps create <short name>
astra apps click <app name or id> <selector>
astra apps fill <app name or id> <selector> <value>
astra call --stdin

Commands return JSON. Inspect an app before selecting its controls.
call --stdin accepts the astra tool's JSON action, including canvas updates.
`;

async function main(args: string[]) {
  if (
    args.length === 0 ||
    (args.length === 1 && ["--help", "-h", "help"].includes(args[0]))
  ) {
    console.log(HELP);
    return;
  }
  let request: unknown;
  const [group, action, target, selector, value] = args;
  if (args.length === 1 && ["status", "home"].includes(group))
    request = { action: group };
  else if (group === "call" && action === "--stdin" && args.length === 2)
    request = JSON.parse(readFileSync(0, "utf8"));
  else if (group === "apps") {
    if (action === "list" && args.length === 2) request = { action };
    else if (action === "create" && target && args.length === 3)
      request = { action, name: target };
    else {
      const lengths: Record<string, number> = {
        open: 3,
        read: 3,
        inspect: 3,
        click: 4,
        fill: 5,
      };
      if (!target || args.length !== lengths[action])
        throw new Error("Invalid command. Run astra --help for syntax.");
      const apps = await requestAstra({ action: "list" });
      if (
        !Array.isArray(apps) ||
        !apps.every(
          (app) =>
            app && typeof app.id === "string" && typeof app.name === "string",
        )
      )
        throw new Error("Astra returned an invalid app list.");
      const found = apps.filter(
        (app) =>
          app.id === target ||
          app.name?.toLocaleLowerCase() === target.toLocaleLowerCase(),
      );
      if (found.length !== 1)
        throw new Error(
          found.length
            ? "Several apps have that name. Use an app id from astra apps list."
            : "App not found. Run astra apps list.",
        );
      request = {
        action,
        id: found[0].id,
        ...(selector ? { selector } : {}),
        ...(value !== undefined ? { value } : {}),
      };
    }
  } else throw new Error("Invalid command. Run astra --help for syntax.");
  console.log(JSON.stringify(await requestAstra(request)));
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
