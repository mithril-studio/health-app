export const telegramCopy = {
  title: "Your coach, in Telegram",
  detail:
    "Morning at 08:30, evening at 21:00, and feedback after workouts. Amsterdam time.",
  connected: "Connected to your private chat",
  disconnected: "Link your own chat to enable reports and two-way coaching.",
  checking: "Checking connection…",
  connect: "Connect Telegram",
  reconnect: "Link another chat",
  connecting: "Creating secure link…",
  open: "Open Coach Reachy in Telegram",
  instruction:
    "Open the link and press Start in Telegram. This one-time link expires after 10 minutes.",
  refresh: "Check connection",
  failed: "Could not load Telegram connection. Try again.",
} as const;
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
