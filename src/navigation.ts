const MAX_EXTERNAL_URL_LENGTH = 2048;

export function externalWebUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_EXTERNAL_URL_LENGTH)
    throw new Error("The web link is missing or too long.");
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Only HTTP and HTTPS web links can open externally.");
  return url.href;
}
