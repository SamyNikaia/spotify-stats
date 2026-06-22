# Spotify Stats

Static, no-backend SPA that shows your **top artists and tracks** on Spotify across 3 time ranges (4 weeks, 6 months, 1 year). Authenticates against Spotify via the **OAuth 2.0 PKCE** flow — tokens live in your browser only, nothing is sent to a third-party server.

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

When deploying to a public URL (Vercel, Netlify, GitHub Pages, …), add that URL to the **Redirect URIs** in the Spotify dashboard. You can keep the local `http://127.0.0.1:8888/` URI in parallel — Spotify allows multiple.

## Notes

- Spotify's Web API only exposes 3 time ranges: `short_term` (~4 weeks), `medium_term` (~6 months), `long_term` (~1 year). There is no true "all time" since late 2024.
- Tokens are stored in `localStorage`. **Logout** clears them.
- Without **Extended Quota Mode** approval from Spotify, your app stays in Development mode and only the 25 users you manually add in the dashboard can log in.
