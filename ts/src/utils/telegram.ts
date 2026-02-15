/**
 * Shared Telegram helpers. Bot token resolution uses the same priority as Config:
 * TELEGRAM_DEV_AGENT_BOT_TOKEN then TELEGRAM_BOT_TOKEN.
 */
export function getTelegramBotToken(inputToken: string | undefined | null): string {
  const trimmed = (inputToken ?? "").trim();
  if (trimmed && !trimmed.startsWith("{{")) {
    return trimmed;
  }
  return (
    process.env.TELEGRAM_DEV_AGENT_BOT_TOKEN ||
    process.env.TELEGRAM_BOT_TOKEN ||
    ""
  ).trim();
}
