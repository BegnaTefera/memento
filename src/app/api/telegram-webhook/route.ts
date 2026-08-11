import { NextRequest, NextResponse } from "next/server";
import { sendTelegramMessage } from "@/lib/telegram";

export const runtime = "nodejs";

/**
 * POST /api/telegram-webhook
 *
 * Telegram calls this URL whenever someone messages the bot, once the webhook
 * is registered (see README — setWebhook step). Not needed for the core
 * "post album to channel" flow, but this is the hook point for extras later,
 * e.g. a guest DMing the bot to get just their own photos.
 *
 * Kept intentionally minimal for now — just replies so you can confirm the
 * webhook is wired up correctly during testing.
 */
export async function POST(req: NextRequest) {
  const update = await req.json();
  console.log("Telegram update:", JSON.stringify(update));

  const message = update.message;
  if (message?.chat?.id && message?.text) {
    const chatId = String(message.chat.id);
    if (message.text === "/start") {
      await sendTelegramMessage(
        chatId,
        "👋 Memento bot is alive. Photo albums will post here automatically at reveal time."
      );
    }
  }

  // Telegram just needs a 200 back — it doesn't care about the body.
  return NextResponse.json({ ok: true });
}
