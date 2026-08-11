# Memento

A personal, web-only disposable-camera event app. Guests capture photos from
a browser (no install), the host controls the reveal, and the final album
posts automatically to a Telegram channel.

Stack: Next.js (App Router) on **Vercel** (free) + **Firebase** Auth/Firestore
(free Spark tier) + **Cloudinary** for photo storage (free tier) + a
**Telegram bot**. No paid tier or credit card required anywhere.

Note: Firebase now requires the paid Blaze plan just to provision Cloud
Storage (a Feb 2026 policy change), so photo storage lives on Cloudinary
instead — Firestore and Auth stay on Firebase's card-free Spark tier.

## 1. Create the Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project** → name it `memento` → skip Google Analytics (not needed). If the project ID (shown below the name field) is already taken, Firebase will suggest a variant like `memento-events` or `memento-xxxxx` — either is fine, just note whichever one you end up with, since you'll need it for `FIREBASE_PROJECT_ID` and `NEXT_PUBLIC_FIREBASE_PROJECT_ID`.
2. **Build > Authentication** → Get started → enable **Google** sign-in provider (this is how you, the host, log in).
3. **Build > Firestore Database** → Create database → **Standard edition** → start in **production mode** → pick a region close to you.
4. **Project settings (gear icon) > General** → scroll to "Your apps" → click the web icon `</>` → register an app (no hosting needed) → copy the `firebaseConfig` values into `.env.local` as the `NEXT_PUBLIC_FIREBASE_*` vars.
5. **Project settings > Service accounts** → **Generate new private key** → downloads a JSON file. From that file:
   - `project_id` → `FIREBASE_PROJECT_ID`
   - `client_email` → `FIREBASE_CLIENT_EMAIL`
   - `private_key` → `FIREBASE_PRIVATE_KEY` (paste exactly as-is, quotes and `\n` included)

## 2. Deploy Firestore rules and indexes

Install the Firebase CLI once, then from the project root:

```bash
npm install -g firebase-tools
firebase login
firebase init   # select Firestore only, point at this project, don't overwrite the .rules/.indexes files
firebase deploy --only firestore:rules,firestore:indexes
```

This pushes `firestore.rules` and `firestore.indexes.json` from this repo.
The composite index (for the reveal-check query) takes a few minutes to
finish building in the Firebase console after deploying — check
**Firestore > Indexes** before testing the reveal flow.

## 3. Create the Cloudinary account (photo storage, free, no card)

1. Go to [cloudinary.com](https://cloudinary.com) → sign up for the free plan.
2. Your dashboard home page shows **Cloud name**, **API Key**, and **API Secret** right at the top → copy these into `.env.local` as `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.

That's it — no bucket or region setup needed. Photos upload as Cloudinary's
"authenticated" asset type, so they aren't publicly viewable by URL; the app
generates a signed URL on demand only when the gallery API or the Telegram
reveal actually needs one.

## 4. Create the Telegram bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram → `/newbot` → follow the prompts → copy the token it gives you into `TELEGRAM_BOT_TOKEN`.
2. Create a Telegram **channel** (this is where albums get posted) → Administrators → **Add Admin** → search your bot's username → give it permission to post messages.
3. Get the channel's chat ID: easiest way is to post any message in the channel, then visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser — look for `"chat":{"id":-100...}` in the response. That negative number is your `telegramChatId` — you'll paste it into the event's "Telegram chat ID" field when creating an event in the host dashboard.

## 5. Run locally

```bash
cp .env.local.example .env.local   # fill in the values from steps 1 and 4
npm install
npm run dev
```

Visit `http://localhost:3000/host`, sign in with Google, create a test event
with a short photo cap (e.g. 2) and **Reveal: Immediately** for your first
test — that skips the cron/scheduling piece so you can confirm the upload +
Telegram post work before adding timing into the mix.

Note: the camera (`getUserMedia`) requires HTTPS or `localhost` — it won't
work over plain HTTP even on your local network, so test on `localhost`
directly or after deploying to Vercel.

## 6. Deploy to Vercel (free)

1. Push this repo to GitHub.
2. [vercel.com](https://vercel.com) → New Project → import the repo.
3. Add every variable from `.env.local` in the Vercel project's **Settings > Environment Variables** (same names, real values).
4. Deploy. You'll get a `*.vercel.app` URL — that's your live app.

## 7. Set up the reveal cron (only needed for delayed reveals)

Vercel's free Hobby plan only allows daily cron jobs, so we drive the
minute-by-minute reveal check from outside Vercel instead:

1. Go to [cron-job.org](https://cron-job.org) → free account → **Create cronjob**.
2. URL: `https://<your-app>.vercel.app/api/check-reveals?secret=<your CRON_SECRET>`
3. Schedule: every 1 minute.
4. Save. It'll now poll and fire off any due reveals + Telegram posts automatically.

## 8. (Optional) Wire up the Telegram webhook

Only needed if you want the bot to respond to messages (e.g. `/start`).
Not required for the core "post album to channel" flow. Once deployed:

```bash
curl "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=https://<your-app>.vercel.app/api/telegram-webhook"
```

## Testing checklist

- [ ] Create an event with "Reveal: Immediately", cap of 2 photos
- [ ] Open the guest link in a private/incognito window (simulates a guest)
- [ ] Allow camera access, take a photo — confirm it uploads and the counter decrements
- [ ] Take a 3rd photo — confirm it's blocked with "No shots left"
- [ ] Switch an event to "Reveal: at a scheduled time" 2 minutes out, confirm cron-job.org triggers `/api/check-reveals` and the album lands in your Telegram channel
