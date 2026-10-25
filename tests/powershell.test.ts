import { expect, test } from "bun:test";
import { runPowerShell } from "../src/powershell";

test("PowerShell rejects invalid requests before launching a process", async () => {
  for (const request of [
    { script: " " },
    { script: "42", args: [1] },
    { script: "42", executable: "cmd.exe" },
  ])
    await expect(runPowerShell(request)).rejects.toThrow();
});

test.skipIf(process.platform !== "win32")(
  "PowerShell keeps Unicode, quotes and shell syntax as literal arguments",
  async () => {
    const args = [
      'café "quoted"; $(Write-Output injected)\nsecond line',
      "",
      "-NoProfile",
      "C:\\A folder\\",
    ];
    expect(
      JSON.parse(
        await runPowerShell({
          script: "ConvertTo-Json -InputObject @($args) -Compress",
          args,
        }),
      ),
    ).toEqual(args);
    expect(await runPowerShell({ script: "6 * 7" })).toBe("42");
  },
  30_000,
);

test.skipIf(process.platform !== "win32")(
  "PowerShell reports nonterminating errors and oversized output",
  async () => {
    await expect(
      runPowerShell({ script: "Write-Error 'Native action failed'" }),
    ).rejects.toThrow("Native action failed");
    await expect(runPowerShell({ script: "'x' * 100000" })).rejects.toThrow(
      "64 KB",
    );
  },
  30_000,
);
