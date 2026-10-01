import { copy } from "./i18n";
export const telegramCopy = copy.telegram;
export function pairingURL(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid pairing response");
  const url = new URL(value);
  if (
    url.origin !== "https://t.me" ||
    url.username !== "" ||
    url.password !== "" ||
    !/^\/[A-Za-z0-9_]+$/.test(url.pathname) ||
    !url.searchParams.get("start")
  ) {
    throw new Error("Invalid pairing response");
  }
  return url.href;
}
