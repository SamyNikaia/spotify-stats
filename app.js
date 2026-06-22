// Spotify Stats — PKCE, no backend.
// Tokens live in the browser only (localStorage).

const REDIRECT_URI = window.location.origin + window.location.pathname;
const SCOPES = window.SPOTIFY_CONFIG?.SCOPES || "user-top-read";
const CONFIG_CLIENT_ID = window.SPOTIFY_CONFIG?.CLIENT_ID || "";
const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const els = {
  notConfigured: $("#not-configured"),
  login: $("#login"),
  app: $("#app"),
  loginBtn: $("#login-btn"),
  logoutBtn: $("#logout"),
  themeToggle: $("#theme-toggle"),
  redirectHint: $$("[data-redirect-uri]"),
  tabs: $$(".tab"),
  artists: $("#artists"),
  tracks: $("#tracks"),
  genres: $("#genres"),
  recents: $("#recents"),
  nowPlaying: $("#now-playing"),
  npArt: $("#np-art"),
  npTitle: $("#np-title"),
  npArtist: $("#np-artist"),
  npProgress: $("#np-progress-fill"),
  savePlaylist: $("#save-playlist"),
  playlistStatus: $("#playlist-status"),
  error: $("#error"),
  userTag: $("#user-tag"),
};

// ---------- Theme ----------
const THEME_KEY = "sp_theme";
function systemTheme() {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}
function currentTheme() {
  return localStorage.getItem(THEME_KEY) || systemTheme();
}
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}
function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}
applyTheme(currentTheme());
window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
  if (!localStorage.getItem(THEME_KEY)) applyTheme(systemTheme());
});

els.redirectHint.forEach((el) => { el.textContent = REDIRECT_URI; });

// ---------- Storage ----------
const store = {
  // CLIENT_ID resolution: config.js wins, legacy localStorage value is the fallback.
  get clientId() { return CONFIG_CLIENT_ID || localStorage.getItem("sp_client_id") || ""; },
  get accessToken() { return localStorage.getItem("sp_access_token"); },
  set accessToken(v) { localStorage.setItem("sp_access_token", v); },
  get refreshToken() { return localStorage.getItem("sp_refresh_token"); },
  set refreshToken(v) { localStorage.setItem("sp_refresh_token", v); },
  get tokenExpiresAt() { return Number(localStorage.getItem("sp_expires_at") || 0); },
  set tokenExpiresAt(v) { localStorage.setItem("sp_expires_at", String(v)); },
  get verifier() { return sessionStorage.getItem("sp_verifier"); },
  set verifier(v) { sessionStorage.setItem("sp_verifier", v); },
  clearTokens() {
    localStorage.removeItem("sp_access_token");
    localStorage.removeItem("sp_refresh_token");
    localStorage.removeItem("sp_expires_at");
  },
};

// ---------- PKCE helpers ----------
function randomString(len = 64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]).join("");
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

function b64url(bytes) {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function challengeFromVerifier(verifier) {
  return b64url(await sha256(verifier));
}

// ---------- Auth flow ----------
async function startLogin() {
  const verifier = randomString(64);
  store.verifier = verifier;
  const challenge = await challengeFromVerifier(verifier);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: store.clientId,
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
    redirect_uri: REDIRECT_URI,
  });
  window.location.assign(`${AUTH_URL}?${params.toString()}`);
}

async function exchangeCodeForToken(code) {
  const verifier = store.verifier;
  if (!verifier) throw new Error("Verifier PKCE manquant (session expirée).");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: store.clientId,
    code_verifier: verifier,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Échange token échoué: ${res.status} ${await res.text()}`);
  const data = await res.json();
  store.accessToken = data.access_token;
  if (data.refresh_token) store.refreshToken = data.refresh_token;
  store.tokenExpiresAt = Date.now() + (data.expires_in - 30) * 1000;
}

async function refreshAccessToken() {
  const rt = store.refreshToken;
  if (!rt) throw new Error("Pas de refresh token — reconnexion nécessaire.");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: rt,
    client_id: store.clientId,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Refresh échoué: ${res.status}`);
  const data = await res.json();
  store.accessToken = data.access_token;
  if (data.refresh_token) store.refreshToken = data.refresh_token;
  store.tokenExpiresAt = Date.now() + (data.expires_in - 30) * 1000;
}

async function ensureFreshToken() {
  if (!store.accessToken) return false;
  if (Date.now() < store.tokenExpiresAt) return true;
  try {
    await refreshAccessToken();
    return true;
  } catch (e) {
    store.clearTokens();
    return false;
  }
}

// ---------- API ----------
async function api(path, options = {}) {
  const { method = "GET", body } = options;
  const headers = { Authorization: `Bearer ${store.accessToken}` };
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    const ok = await ensureFreshToken();
    if (!ok) throw new Error("Session expirée. Reconnecte-toi.");
    return api(path, options);
  }
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`API ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function fetchTops(range) {
  const [artists, tracks, me] = await Promise.all([
    api(`/me/top/artists?time_range=${range}&limit=50`),
    api(`/me/top/tracks?time_range=${range}&limit=50`),
    api(`/me`),
  ]);
  return { artists: artists.items, tracks: tracks.items, me };
}

async function fetchRecents() {
  const data = await api(`/me/player/recently-played?limit=50`);
  return data.items;
}

async function fetchNowPlaying() {
  // 204 No Content = nothing playing right now.
  const res = await fetch(`${API}/me/player/currently-playing`, {
    headers: { Authorization: `Bearer ${store.accessToken}` },
  });
  if (res.status === 204) return null;
  if (res.status === 401) {
    const ok = await ensureFreshToken();
    if (!ok) return null;
    return fetchNowPlaying();
  }
  if (!res.ok) return null;
  return res.json();
}

// ---------- Render ----------
function showSkeletons() {
  const skel = Array.from({ length: 10 }, () => `<li class="skeleton"></li>`).join("");
  els.artists.innerHTML = skel;
  els.tracks.innerHTML = skel;
  els.genres.innerHTML = "";
}

function aggregateGenres(artists) {
  const counts = new Map();
  artists.forEach((a, idx) => {
    // Weighted: top-ranked artists matter more (1 / rank).
    const weight = 1 + (artists.length - idx) / artists.length;
    (a.genres || []).forEach(g => {
      counts.set(g, (counts.get(g) || 0) + weight);
    });
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, score]) => ({ name, score }));
}

const relTime = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return relTime.format(-Math.round(diff / 60), "minute");
  if (diff < 86400) return relTime.format(-Math.round(diff / 3600), "hour");
  return relTime.format(-Math.round(diff / 86400), "day");
}

function renderRecents(items) {
  if (!items?.length) {
    els.recents.innerHTML = `<li class="genre-head">Aucun titre récent.</li>`;
    return;
  }
  els.recents.innerHTML = items.map((it) => {
    const t = it.track;
    const img = (t.album?.images && t.album.images[t.album.images.length - 1]?.url) || "";
    const artists = (t.artists || []).map(a => escapeHtml(a.name)).join(", ");
    return `<li class="row fade-in">
      ${img ? `<img src="${img}" alt="" loading="lazy" />` : ""}
      <div class="meta">
        <a href="${t.external_urls.spotify}" target="_blank" rel="noopener">
          <div class="title">${escapeHtml(t.name)}</div>
        </a>
        <div class="artist">${artists}</div>
      </div>
      <span class="when">${timeAgo(it.played_at)}</span>
    </li>`;
  }).join("");
}

function renderNowPlaying(data) {
  if (!data || !data.item) {
    els.nowPlaying.classList.add("hidden");
    return;
  }
  const t = data.item;
  const img = t.album?.images?.[0]?.url || "";
  els.npArt.style.backgroundImage = img ? `url("${img}")` : "";
  els.npTitle.textContent = t.name;
  els.npArtist.textContent = (t.artists || []).map(a => a.name).join(", ");
  const pct = t.duration_ms ? Math.min(100, (data.progress_ms / t.duration_ms) * 100) : 0;
  els.npProgress.style.width = `${pct}%`;
  els.nowPlaying.classList.remove("hidden");
}

function renderGenres(items) {
  if (!items.length) {
    els.genres.innerHTML = `<li class="genre-head">Pas assez de données pour cette période.</li>`;
    return;
  }
  const max = items[0].score;
  els.genres.innerHTML = items.map((g, i) => {
    const pct = Math.round((g.score / max) * 100);
    return `<li class="genre fade-in">
      <div class="genre-head">
        <span class="rank">${i + 1}</span>
        <span>${escapeHtml(g.name)}</span>
      </div>
      <span class="genre-count">${pct}%</span>
      <div class="genre-bar"><span style="width:${pct}%"></span></div>
    </li>`;
  }).join("");
}

function renderArtists(items) {
  els.artists.innerHTML = items.map((a, i) => {
    const img = (a.images && a.images[a.images.length - 1]?.url) || "";
    return `<li class="row fade-in">
      <span class="rank">${i + 1}</span>
      ${img ? `<img src="${img}" alt="" loading="lazy" />` : ""}
      <div class="meta">
        <a href="${a.external_urls.spotify}" target="_blank" rel="noopener">
          <div class="title">${escapeHtml(a.name)}</div>
        </a>
        <div class="artist">${(a.genres || []).slice(0, 2).map(escapeHtml).join(" · ") || "—"}</div>
      </div>
    </li>`;
  }).join("");
}

function renderTracks(items) {
  els.tracks.innerHTML = items.map((t, i) => {
    const img = (t.album?.images && t.album.images[t.album.images.length - 1]?.url) || "";
    const artists = (t.artists || []).map(a => escapeHtml(a.name)).join(", ");
    return `<li class="row fade-in">
      <span class="rank">${i + 1}</span>
      ${img ? `<img src="${img}" alt="" loading="lazy" />` : ""}
      <div class="meta">
        <a href="${t.external_urls.spotify}" target="_blank" rel="noopener">
          <div class="title">${escapeHtml(t.name)}</div>
        </a>
        <div class="artist">${artists}</div>
      </div>
    </li>`;
  }).join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function showError(msg) {
  els.error.textContent = msg;
  els.error.classList.remove("hidden");
}
function clearError() {
  els.error.textContent = "";
  els.error.classList.add("hidden");
}

// ---------- State / routing ----------
let currentRange = "short_term";
let lastSnapshot = { range: null, tracks: [], me: null };
let nowPlayingTimer = null;
const NOW_PLAYING_INTERVAL_MS = 20_000;

const RANGE_LABELS = {
  short_term: "4 dernières semaines",
  medium_term: "6 derniers mois",
  long_term: "1 dernière année",
};

async function loadRange(range) {
  currentRange = range;
  els.tabs.forEach(t => t.classList.toggle("active", t.dataset.range === range));
  showSkeletons();
  clearError();
  try {
    const { artists, tracks, me } = await fetchTops(range);
    renderArtists(artists);
    renderTracks(tracks);
    renderGenres(aggregateGenres(artists));
    if (me?.display_name) els.userTag.textContent = me.display_name;
    lastSnapshot = { range, tracks, me };
    setPlaylistStatus(null);
    els.savePlaylist.disabled = false;
  } catch (e) {
    showError(e.message || String(e));
    els.artists.innerHTML = "";
    els.tracks.innerHTML = "";
    els.genres.innerHTML = "";
  }
}

async function loadRecents() {
  try {
    renderRecents(await fetchRecents());
  } catch (e) {
    // Non-fatal: missing scope or transient error shouldn't break the page.
    console.warn("recents:", e);
  }
}

async function pollNowPlaying() {
  try {
    renderNowPlaying(await fetchNowPlaying());
  } catch (e) {
    renderNowPlaying(null);
  }
}

function startNowPlaying() {
  stopNowPlaying();
  pollNowPlaying();
  nowPlayingTimer = setInterval(pollNowPlaying, NOW_PLAYING_INTERVAL_MS);
}
function stopNowPlaying() {
  if (nowPlayingTimer) clearInterval(nowPlayingTimer);
  nowPlayingTimer = null;
}

// ---------- Playlist creation ----------
function setPlaylistStatus(msg, { error = false, link = null } = {}) {
  if (!msg) {
    els.playlistStatus.classList.add("hidden");
    els.playlistStatus.textContent = "";
    return;
  }
  els.playlistStatus.classList.remove("hidden");
  els.playlistStatus.classList.toggle("error", error);
  els.playlistStatus.innerHTML = link
    ? `${escapeHtml(msg)} <a href="${link}" target="_blank" rel="noopener">Ouvrir →</a>`
    : escapeHtml(msg);
}

async function createPlaylistFromTopTracks() {
  const { range, tracks, me } = lastSnapshot;
  if (!me || !tracks?.length) {
    setPlaylistStatus("Données pas encore chargées, réessaie dans une seconde.", { error: true });
    return;
  }
  els.savePlaylist.disabled = true;
  setPlaylistStatus("Création de la playlist…");
  try {
    const now = new Date();
    const monthLabel = now.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    const name = `Mes tops — ${RANGE_LABELS[range]} (${monthLabel})`;
    const playlist = await api(`/users/${encodeURIComponent(me.id)}/playlists`, {
      method: "POST",
      body: {
        name,
        description: `Top ${tracks.length} de ${me.display_name || "moi"} sur ${RANGE_LABELS[range]}. Généré via Spotify Stats.`,
        public: false,
      },
    });
    const uris = tracks.map(t => t.uri).filter(Boolean);
    await api(`/playlists/${playlist.id}/tracks`, {
      method: "POST",
      body: { uris },
    });
    setPlaylistStatus(`Playlist "${name}" créée avec ${uris.length} titres.`, {
      link: playlist.external_urls?.spotify,
    });
  } catch (e) {
    setPlaylistStatus(`Échec : ${e.message}`, { error: true });
  } finally {
    els.savePlaylist.disabled = false;
  }
}

function showSection(name) {
  els.notConfigured.classList.toggle("hidden", name !== "not-configured");
  els.login.classList.toggle("hidden", name !== "login");
  els.app.classList.toggle("hidden", name !== "app");
}

async function boot() {
  // 1) Retour OAuth ?
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    showError(`Spotify a refusé l'auth : ${oauthError}`);
  }
  if (code) {
    try {
      await exchangeCodeForToken(code);
    } catch (e) {
      showError(e.message);
    }
    // Nettoyer l'URL
    window.history.replaceState({}, document.title, REDIRECT_URI);
  }

  // 2) Configured?
  if (!store.clientId) {
    showSection("not-configured");
    return;
  }
  const hasToken = await ensureFreshToken();
  if (!hasToken) {
    showSection("login");
    return;
  }
  showSection("app");
  loadRange(currentRange);
  loadRecents();
  startNowPlaying();
}

// ---------- Event wiring ----------
els.loginBtn.addEventListener("click", () => {
  clearError();
  startLogin().catch(e => showError(e.message));
});

els.logoutBtn.addEventListener("click", () => {
  store.clearTokens();
  stopNowPlaying();
  showSection("login");
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopNowPlaying();
  else if (store.accessToken && !els.app.classList.contains("hidden")) startNowPlaying();
});

els.tabs.forEach(t => {
  t.addEventListener("click", () => loadRange(t.dataset.range));
});

els.themeToggle.addEventListener("click", toggleTheme);
els.savePlaylist.addEventListener("click", createPlaylistFromTopTracks);

boot();
