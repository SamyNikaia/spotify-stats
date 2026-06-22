# Spotify Stats

Static, no-backend SPA that shows your **top artists**, **top tracks**, **top genres**, **recently played** and **currently playing** on Spotify across 3 time ranges (4 weeks, 6 months, 1 year). One-click export of your top to an Instagram-ready PNG or a private Spotify playlist. Authenticates against Spotify via the **OAuth 2.0 PKCE** flow — tokens live in your browser only, nothing is sent to a third-party server.

## Features

- Top 50 artists, top 50 tracks, top 12 genres per period
- Currently playing widget with auto-refresh
- Recently played (last 50 tracks) with relative timestamps
- Light / dark theme with system-preference detection
- Save current top tracks as a private Spotify playlist
- Export top stats as a 1080×1350 PNG card (Instagram 4:5)

## Setup (once, ~2 min)

1. Go to https://developer.spotify.com/dashboard and click **Create app**.
2. Pick any name and description.
3. Under **Redirect URIs**, add exactly:
   ```
   http://127.0.0.1:8888/
   ```
   (the trailing `/` matters)
4. Tick **Web API**, then **Save**.
5. Copy the **Client ID** and paste it into [`config.js`](./config.js) at the root:
   ```js
   window.SPOTIFY_CONFIG = {
     CLIENT_ID: "your-client-id-here",
     ...
   };
   ```

> No Client Secret needed — PKCE handles that.

## Run locally

From the project root:

### macOS / Linux
```bash
./start.sh
```

### Windows
```bat
start.bat
```

Both scripts start a local Python HTTP server on port 8888 and open `http://127.0.0.1:8888/` in your browser.

## Deploy

The repo ships with a [`vercel.json`](./vercel.json) that sets strict security headers (CSP, Permissions-Policy, X-Frame-Options) tuned for the Spotify OAuth + CDN flow.

```bash
npm i -g vercel       # once
vercel login          # once
vercel --prod         # from the project root
```

After the first deploy, copy the Vercel URL (e.g. `https://spotify-stats-xxx.vercel.app/`) and add it to **Redirect URIs** in your Spotify dashboard alongside `http://127.0.0.1:8888/`. Spotify allows multiple URIs so you keep working locally.

### Going public to anyone (Extended Quota Mode)

Out of the box, a Spotify app is in **Development Mode** and only the 25 users you manually add in the dashboard can sign in. To open it to everyone you need to apply for **Extended Quota Mode** from your app dashboard. The review typically takes 1–3 weeks. The application will ask for:

- A public **Privacy Policy** URL → [`/privacy.html`](./privacy.html)
- A public **Terms of Service** URL → [`/terms.html`](./terms.html)
- A short demo video (1–2 min Loom is enough)
- The deployed app URL with a working sign-in flow

## Notes

- Spotify's Web API only exposes 3 time ranges: `short_term` (~4 weeks), `medium_term` (~6 months), `long_term` (~1 year). There is no true "all time" since late 2024.
- Tokens are stored in `localStorage`. **Logout** clears them.
- Without **Extended Quota Mode** approval from Spotify, your app stays in Development mode and only the 25 users you manually add in the dashboard can log in.
