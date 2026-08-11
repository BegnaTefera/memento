// Thin wrapper around the Telegram Bot API. Server-only (needs the bot token).
// Bot token comes from @BotFather — see project README for setup steps.

const TELEGRAM_API_BASE = "https://api.telegram.org";

function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN env var");
  return token;
}

/**
 * Sends a plain text message to a chat/channel.
 */
export async function sendTelegramMessage(chatId: string, text: string) {
  const url = `${TELEGRAM_API_BASE}/bot${getBotToken()}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram sendMessage failed: ${res.status} ${body}`);
  }
  return res.json();
}

/**
 * Posts a batch of photos as an album (media group) to a chat/channel.
 * Telegram caps sendMediaGroup at 10 items per call, so we chunk automatically.
 * `photoUrls` must be publicly reachable URLs (Firebase Storage download URLs work).
 */
export async function sendTelegramPhotoAlbum(
  chatId: string,
  photoUrls: string[],
  caption?: string
) {
  const token = getBotToken();
  const chunks: string[][] = [];
  for (let i = 0; i < photoUrls.length; i += 10) {
    chunks.push(photoUrls.slice(i, i + 10));
  }

  const results = [];
  for (const [index, chunk] of chunks.entries()) {
    const media = chunk.map((url, i) => ({
      type: "photo",
      media: url,
      // Only caption the very first photo of the very first chunk, so the
      // caption shows once at the top of the album rather than repeating.
      ...(index === 0 && i === 0 && caption ? { caption } : {}),
    }));

    const url = `${TELEGRAM_API_BASE}/bot${token}/sendMediaGroup`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, media }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Telegram sendMediaGroup failed: ${res.status} ${body}`);
    }
    results.push(await res.json());
  }
  return results;
}
