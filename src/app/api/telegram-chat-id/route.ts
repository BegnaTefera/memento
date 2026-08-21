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

    // getUpdates cannot be used while a webhook is active. Never delete the
    // webhook here: doing so makes the bot stop responding until setWebhook
    // is run again. Public channels can be resolved directly by username.
    const lookup = normalizeLookup(query);
    if (!/^[a-z0-9_]+$/i.test(lookup)) {
      return NextResponse.json({
        error: "Use a public channel username such as @mychannel, or paste the numeric chat ID.",
      }, { status: 400 });
    }

    const res = await fetch(
      `https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(`@${lookup}`)}`
    );
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Telegram lookup failed: ${text}` }, { status: 502 });
    }

    const data = await res.json();
    if (!data?.ok) {
      return NextResponse.json({ error: data?.description ?? "Telegram lookup failed." }, { status: 400 });
    }

    const chat = data.result;
    if (!chat || !["channel", "supergroup", "group"].includes(chat.type)) {
      return NextResponse.json({
        error: "That username is not a Telegram channel or group the bot can access.",
        matches: [],
      }, { status: 404 });
    }

    const match = {
      id: String(chat.id),
      title: chat.title ?? chat.first_name ?? chat.username ?? "Telegram chat",
      username: chat.username ? `@${chat.username}` : undefined,
      type: chat.type,
    };
    return NextResponse.json({ matches: [match], selectedId: match.id });
  } catch (error) {
    console.error("Telegram chat ID lookup failed:", error);
    return NextResponse.json({ error: "Failed to look up the Telegram chat ID." }, { status: 500 });
  }
}
