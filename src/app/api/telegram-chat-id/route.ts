import { NextResponse } from "next/server";

export const runtime = "nodejs";

function normalizeLookup(value: string) {
  const raw = value.trim().toLowerCase();
  const withoutProtocol = raw.replace(/^https?:\/\//, "").replace(/^www\./, "");
  const withoutTrailingSlash = withoutProtocol.replace(/\/+$/, "");

  const asUrl = withoutTrailingSlash
    .replace(/^t\.me\//, "")
    .replace(/^telegram\.me\//, "")
    .replace(/^tg\//, "");

  if (!asUrl) return "";

  const match = asUrl.match(/^(?:@)?([a-z0-9_]+)(?:\/[a-z0-9_]+)?$/i);
  if (match) return match[1].toLowerCase();

  const titleMatch = asUrl.match(/^(?:@)?(.+)$/i);
  if (titleMatch) return titleMatch[1].toLowerCase();

  return asUrl.toLowerCase();
}

function getChatFromUpdate(update: Record<string, any>) {
  return (
    update?.message?.chat ??
    update?.channel_post?.chat ??
    update?.edited_channel_post?.chat ??
    update?.edited_message?.chat ??
    update?.callback_query?.message?.chat ??
    update?.my_chat_member?.chat ??
    update?.chat_member?.chat
  );
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { query?: string };
    const query = String(body?.query ?? "").trim();

    if (!query) {
      return NextResponse.json({ error: "Provide a channel name, @username, or Telegram link." }, { status: 400 });
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      return NextResponse.json({ error: "Telegram bot is not configured on this server." }, { status: 500 });
    }

    const deleteWebhookRes = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`);
    if (!deleteWebhookRes.ok) {
      const deleteText = await deleteWebhookRes.text();
      console.warn("Telegram deleteWebhook failed:", deleteText);
    }

    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Telegram lookup failed: ${text}` }, { status: 502 });
    }

    const data = await res.json();
    if (!data?.ok) {
      return NextResponse.json({ error: data?.description ?? "Telegram lookup failed." }, { status: 400 });
    }

    const lookup = normalizeLookup(query);
    const matches: Array<{ id: string; title: string; username?: string; type: string }> = [];
    const seen = new Set<string>();

    for (const update of data.result ?? []) {
      const chat = getChatFromUpdate(update);
      if (!chat || !["channel", "supergroup", "group"].includes(chat.type)) continue;

      const title = chat.title ?? chat.first_name ?? chat.username ?? "Telegram chat";
      const username = chat.username ? `@${chat.username}` : undefined;
      const id = String(chat.id);
      if (seen.has(id)) continue;

      const haystack = [title, username ?? "", chat.type, id]
        .join(" ")
        .toLowerCase();
      const normalizedTitle = title.toLowerCase();
      const lookupMatches = !lookup || haystack.includes(lookup) || normalizedTitle.includes(lookup);

      if (lookupMatches) {
        matches.push({ id, title, username, type: chat.type });
        seen.add(id);
      }
    }

    if (!matches.length) {
      return NextResponse.json({
        error: "No matching Telegram channel was found. Make sure the bot is an admin in the channel and the channel has had some recent activity.",
        matches: [],
      }, { status: 404 });
    }

    return NextResponse.json({ matches, selectedId: matches[0].id });
  } catch (error) {
    console.error("Telegram chat ID lookup failed:", error);
    return NextResponse.json({ error: "Failed to look up the Telegram chat ID." }, { status: 500 });
  }
}
