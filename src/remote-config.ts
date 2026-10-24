import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import type { RemoteConfig } from "./remote-server";

export const DEFAULT_REMOTE_PORT = 4319;
export const remoteConfigSchema = z
  .object({
    origin: z
      .string()
      .url()
      .refine((value) => {
        if (!URL.canParse(value)) return false;
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          url.origin === value &&
          !url.username &&
          !url.password
        );
      }, "Use the exact HTTPS origin of your private Astra site, without a trailing slash."),
    user: z
      .string()
      .min(1)
      .max(320)
      .refine((value) => value.trim() === value && !/[\r\n]/.test(value)),
    port: z.number().int().min(1024).max(65535).default(DEFAULT_REMOTE_PORT),
  })
  .strict();

export function readRemoteConfig(path: string): RemoteConfig | null {
  if (!existsSync(path)) return null;
  try {
    return remoteConfigSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    throw new Error(
      `Invalid Astra remote configuration at ${path}. Set an exact HTTPS origin, Tailscale user login and local port.`,
    );
  }
}
