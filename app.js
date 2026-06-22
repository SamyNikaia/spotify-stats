"use strict";

// Spotify Stats — flow PKCE, aucun backend.
// Les tokens vivent uniquement dans le navigateur (localStorage).

const REDIRECT_URI = window.location.origin + window.location.pathname;
const SCOPES = window.SPOTIFY_CONFIG?.SCOPES || "user-top-read";
const CONFIG_CLIENT_ID = window.SPOTIFY_CONFIG?.CLIENT_ID || "";
const AUTH_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API = "https://api.spotify.com/v1";

// Domaines auxquels on autorise les images (Spotify CDN + avatars FB-linked).
const ALLOWED_IMAGE_HOSTS = new Set([
  "i.scdn.co",
  "mosaic.scdn.co",
  "platform-lookaside.fbsbx.com",
]);

const TOP_VISIBLE_DEFAULT = 10;
const NOW_PLAYING_INTERVAL_MS = 20_000;
const SEARCH_DEBOUNCE_MS = 320;
const SEARCH_LIMIT_PER_TYPE = 5;
const SEARCH_QUERY_MAX_LEN = 200;
// Borne large mais finie pour repérer un ?code= clairement bidon avant de POST.
const OAUTH_CODE_MAX_LEN = 1024;
const OAUTH_STATE_LEN = 24;
const PKCE_VERIFIER_LEN = 64;

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
  exportImage: $("#export-image"),
  expandToggles: $$(".list-expand"),
  searchInput: $("#search-input"),
  searchClear: $("#search-clear"),
  searchResults: $("#search-results"),
  modal: $("#detail-modal"),
  modalBody: $("#modal-body"),
  modalCloseTriggers: $$("[data-modal-close]"),
  error: $("#error"),
  userTag: $("#user-tag"),
};

// ============================================================
// Helpers de sécurité (XSS / open redirect / injection URL)
// ============================================================

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

// N'autorise que http(s). Renvoie "#" sinon, ce qui rend tout lien inerte
// si l'API renvoyait un jour un `javascript:` ou autre schéma exotique.
function safeUrl(url) {
  if (typeof url !== "string" || !url) return "#";
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "#";
    return u.href;
  } catch {
    return "#";
  }
}

// Whitelist stricte des hôtes d'images. Tout ce qui sort de là est ignoré.
function safeImageUrl(url) {
  if (typeof url !== "string" || !url) return "";
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return "";
    const host = u.hostname;
    if (host.endsWith(".scdn.co") || ALLOWED_IMAGE_HOSTS.has(host)) return u.href;
    return "";
  } catch {
    return "";
  }
}

// Format des URIs Spotify : `spotify:<type>:<id>` avec id base62 sur 22 chars.
function isValidSpotifyTrackUri(uri) {
  return typeof uri === "string" && /^spotify:track:[A-Za-z0-9]{22}$/.test(uri);
}

// Token OAuth de Spotify : alphabet base64url + tirets, et longueur raisonnable.
function looksLikeOauthCode(code) {
  return typeof code === "string"
    && code.length > 0
    && code.length <= OAUTH_CODE_MAX_LEN
    && /^[A-Za-z0-9_\-.~]+$/.test(code);
}

// ============================================================
// Thème
// ============================================================

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

// ============================================================
// Storage
// ============================================================

const store = {
  // Le CLIENT_ID de config.js prime ; fallback sur l'ancien input localStorage
  // pour ne pas casser les sessions des utilisateurs déjà en place.
  get clientId() { return CONFIG_CLIENT_ID || localStorage.getItem("sp_client_id") || ""; },
  get accessToken() { return localStorage.getItem("sp_access_token"); },
  set accessToken(v) { localStorage.setItem("sp_access_token", v); },
  get refreshToken() { return localStorage.getItem("sp_refresh_token"); },
  set refreshToken(v) { localStorage.setItem("sp_refresh_token", v); },
  get tokenExpiresAt() { return Number(localStorage.getItem("sp_expires_at") || 0); },
  set tokenExpiresAt(v) { localStorage.setItem("sp_expires_at", String(v)); },
  // verifier + state vivent en sessionStorage : effacés à la fermeture du tab,
  // ce qui suffit (ils ne servent qu'au round-trip OAuth).
  get verifier() { return sessionStorage.getItem("sp_verifier"); },
  set verifier(v) { sessionStorage.setItem("sp_verifier", v); },
  get oauthState() { return sessionStorage.getItem("sp_state"); },
  set oauthState(v) { sessionStorage.setItem("sp_state", v); },
  clearOauthEphemeral() {
    sessionStorage.removeItem("sp_verifier");
    sessionStorage.removeItem("sp_state");
  },
  clearTokens() {
    localStorage.removeItem("sp_access_token");
    localStorage.removeItem("sp_refresh_token");
    localStorage.removeItem("sp_expires_at");
  },
};

// ============================================================
// PKCE
// ============================================================

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

// ============================================================
// Flow OAuth
// ============================================================

async function startLogin() {
  const verifier = randomString(PKCE_VERIFIER_LEN);
  // `state` : anti-CSRF OAuth — on vérifie au retour que c'est bien nous
  // qui avons lancé la requête (et pas un site tiers qui aurait forgé un lien).
  const state = randomString(OAUTH_STATE_LEN);
  store.verifier = verifier;
  store.oauthState = state;
  const challenge = await challengeFromVerifier(verifier);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: store.clientId,
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
    redirect_uri: REDIRECT_URI,
    state,
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
  if (!res.ok) throw new Error(`Échange token échoué : ${res.status} ${await res.text()}`);
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
  if (!res.ok) throw new Error(`Refresh échoué : ${res.status}`);
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
  } catch {
    store.clearTokens();
    return false;
  }
}

// ============================================================
// API Spotify
// ============================================================

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
  // 204 No Content = rien en lecture en ce moment.
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

// ============================================================
// Agrégation
// ============================================================

function aggregateGenres(artists) {
  const counts = new Map();
  artists.forEach((a, idx) => {
    // Pondération douce : les artistes en haut du top comptent un peu plus,
    // pour qu'un genre porté uniquement par la longue traîne ne domine pas.
    const weight = 1 + (artists.length - idx) / artists.length;
    (a.genres || []).forEach((g) => {
      counts.set(g, (counts.get(g) || 0) + weight);
    });
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, score]) => ({ name, score }));
}

// ============================================================
// Rendu
// ============================================================

const relTime = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return relTime.format(-Math.round(diff / 60), "minute");
  if (diff < 86400) return relTime.format(-Math.round(diff / 3600), "hour");
  return relTime.format(-Math.round(diff / 86400), "day");
}

function showSkeletons() {
  const skel = Array.from({ length: 10 }, () => `<li class="skeleton"></li>`).join("");
  els.artists.innerHTML = skel;
  els.tracks.innerHTML = skel;
  els.genres.innerHTML = "";
}

function renderArtists(items) {
  els.artists.innerHTML = items.map((a, i) => {
    const img = safeImageUrl(a.images?.[a.images.length - 1]?.url);
    const link = safeUrl(a.external_urls?.spotify);
    const genres = (a.genres || []).slice(0, 2).map(escapeHtml).join(" · ") || "—";
    return `<li class="row fade-in">
      <span class="rank">${i + 1}</span>
      ${img ? `<img src="${img}" alt="" loading="lazy" />` : ""}
      <div class="meta">
        <a href="${link}" target="_blank" rel="noopener noreferrer">
          <div class="title">${escapeHtml(a.name)}</div>
        </a>
        <div class="artist">${genres}</div>
      </div>
    </li>`;
  }).join("");
  updateExpandVisibility("artists", items.length);
}

function renderTracks(items) {
  els.tracks.innerHTML = items.map((t, i) => {
    const img = safeImageUrl(t.album?.images?.[t.album.images.length - 1]?.url);
    const link = safeUrl(t.external_urls?.spotify);
    const artists = (t.artists || []).map((a) => escapeHtml(a.name)).join(", ");
    return `<li class="row fade-in">
      <span class="rank">${i + 1}</span>
      ${img ? `<img src="${img}" alt="" loading="lazy" />` : ""}
      <div class="meta">
        <a href="${link}" target="_blank" rel="noopener noreferrer">
          <div class="title">${escapeHtml(t.name)}</div>
        </a>
        <div class="artist">${artists}</div>
      </div>
    </li>`;
  }).join("");
  updateExpandVisibility("tracks", items.length);
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

function renderRecents(items) {
  if (!items?.length) {
    els.recents.innerHTML = `<li class="genre-head">Aucun titre récent.</li>`;
    return;
  }
  els.recents.innerHTML = items.map((it) => {
    const t = it.track;
    const img = safeImageUrl(t.album?.images?.[t.album.images.length - 1]?.url);
    const link = safeUrl(t.external_urls?.spotify);
    const artists = (t.artists || []).map((a) => escapeHtml(a.name)).join(", ");
    return `<li class="row fade-in">
      ${img ? `<img src="${img}" alt="" loading="lazy" />` : ""}
      <div class="meta">
        <a href="${link}" target="_blank" rel="noopener noreferrer">
          <div class="title">${escapeHtml(t.name)}</div>
        </a>
        <div class="artist">${artists}</div>
      </div>
      <span class="when">${escapeHtml(timeAgo(it.played_at))}</span>
    </li>`;
  }).join("");
}

function renderNowPlaying(data) {
  if (!data || !data.item) {
    els.nowPlaying.classList.add("hidden");
    return;
  }
  const t = data.item;
  const img = safeImageUrl(t.album?.images?.[0]?.url);
  // JSON.stringify garantit un quoting CSS sûr du URL.
  els.npArt.style.backgroundImage = img ? `url(${JSON.stringify(img)})` : "";
  els.npTitle.textContent = t.name;
  els.npArtist.textContent = (t.artists || []).map((a) => a.name).join(", ");
  const pct = t.duration_ms ? Math.min(100, (data.progress_ms / t.duration_ms) * 100) : 0;
  els.npProgress.style.width = `${pct}%`;
  els.nowPlaying.classList.remove("hidden");
}

function showError(msg) {
  els.error.textContent = msg;
  els.error.classList.remove("hidden");
}
function clearError() {
  els.error.textContent = "";
  els.error.classList.add("hidden");
}

// ============================================================
// Toggle "Voir tout / Réduire" pour les top lists
// ============================================================

function updateExpandVisibility(target, count) {
  const btn = els.expandToggles.find((b) => b.dataset.target === target);
  if (!btn) return;
  if (count <= TOP_VISIBLE_DEFAULT) {
    btn.classList.add("hidden");
  } else {
    btn.classList.remove("hidden");
    const list = $(`#${target}`);
    const condensed = list.classList.contains("condensed");
    btn.textContent = condensed ? `Voir les ${count}` : "Réduire";
  }
}

function wireExpandToggles() {
  els.expandToggles.forEach((btn) => {
    btn.addEventListener("click", () => {
      const list = $(`#${btn.dataset.target}`);
      if (!list) return;
      const wasCondensed = list.classList.toggle("condensed");
      const total = list.children.length;
      btn.textContent = wasCondensed ? `Voir les ${total}` : "Réduire";
    });
  });
}

// ============================================================
// État applicatif
// ============================================================

let currentRange = "short_term";
let lastSnapshot = { range: null, tracks: [], artists: [], me: null };
let nowPlayingTimer = null;

const RANGE_LABELS = {
  short_term: "4 dernières semaines",
  medium_term: "6 derniers mois",
  long_term: "1 dernière année",
};

async function loadRange(range) {
  currentRange = range;
  els.tabs.forEach((t) => t.classList.toggle("active", t.dataset.range === range));
  showSkeletons();
  clearError();
  try {
    const { artists, tracks, me } = await fetchTops(range);
    renderArtists(artists);
    renderTracks(tracks);
    renderGenres(aggregateGenres(artists));
    if (me?.display_name) els.userTag.textContent = me.display_name;
    lastSnapshot = { range, tracks, artists, me };
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
    // Non bloquant : un scope manquant ne doit pas casser la page.
    console.warn("recents:", e);
  }
}

async function pollNowPlaying() {
  try {
    renderNowPlaying(await fetchNowPlaying());
  } catch {
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

// ============================================================
// Export image
// ============================================================

function loadImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function truncate(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ctx.measureText(text.slice(0, mid) + "…").width <= maxWidth) lo = mid + 1;
    else hi = mid;
  }
  return text.slice(0, Math.max(0, lo - 1)) + "…";
}

async function exportAsImage() {
  const { range, tracks, artists, me } = lastSnapshot;
  if (!me || !tracks.length || !artists.length) return;

  els.exportImage.disabled = true;
  const originalLabel = els.exportImage.textContent;
  els.exportImage.textContent = "Génération…";

  try {
    const W = 1080;
    const H = 1350;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");

    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, "#0b0d10");
    grad.addColorStop(0.6, "#11161d");
    grad.addColorStop(1, "#08130c");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(W * 0.85, H * 0.1, 0, W * 0.85, H * 0.1, 600);
    glow.addColorStop(0, "rgba(30, 215, 96, 0.18)");
    glow.addColorStop(1, "rgba(30, 215, 96, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = "#1ed760";
    ctx.font = "600 22px Inter, system-ui";
    ctx.fillText("SPOTIFY STATS", 60, 90);

    ctx.fillStyle = "#ffffff";
    ctx.font = "700 56px Inter, system-ui";
    ctx.fillText(truncate(ctx, `Top de ${me.display_name || "moi"}`, W - 120), 60, 150);

    ctx.fillStyle = "#8a93a0";
    ctx.font = "400 24px Inter, system-ui";
    ctx.fillText(RANGE_LABELS[range] || range, 60, 188);

    ctx.fillStyle = "#8a93a0";
    ctx.font = "600 16px Inter, system-ui";
    ctx.fillText("TOP 5 ARTISTES", 60, 270);

    const topArtists = artists.slice(0, 5);
    const artistImgs = await Promise.all(topArtists.map((a) => loadImage(safeImageUrl(a.images?.[1]?.url || a.images?.[0]?.url))));
    const aSize = 160;
    const aGap = 24;
    const aTotalW = aSize * 5 + aGap * 4;
    const aStartX = (W - aTotalW) / 2;
    const aY = 300;
    topArtists.forEach((a, i) => {
      const x = aStartX + i * (aSize + aGap);
      ctx.save();
      roundRect(ctx, x, aY, aSize, aSize, 18);
      ctx.clip();
      ctx.fillStyle = "#1a2230";
      ctx.fillRect(x, aY, aSize, aSize);
      if (artistImgs[i]) ctx.drawImage(artistImgs[i], x, aY, aSize, aSize);
      ctx.restore();

      ctx.fillStyle = "#ffffff";
      ctx.font = "600 18px Inter, system-ui";
      ctx.textAlign = "center";
      ctx.fillText(truncate(ctx, a.name, aSize - 8), x + aSize / 2, aY + aSize + 28);
      ctx.textAlign = "left";
    });

    ctx.fillStyle = "#8a93a0";
    ctx.font = "600 16px Inter, system-ui";
    ctx.fillText("TOP 5 TITRES", 60, 580);

    const topTracks = tracks.slice(0, 5);
    const trackImgs = await Promise.all(topTracks.map((t) => loadImage(safeImageUrl(t.album?.images?.[1]?.url || t.album?.images?.[0]?.url))));
    const tHeight = 110;
    const tY0 = 610;
    topTracks.forEach((t, i) => {
      const y = tY0 + i * (tHeight + 16);

      ctx.fillStyle = "#11161d";
      roundRect(ctx, 60, y, W - 120, tHeight, 16);
      ctx.fill();

      ctx.fillStyle = "#5b6573";
      ctx.font = "600 22px Inter, system-ui";
      ctx.fillText(String(i + 1), 84, y + 64);

      const imgSize = 76;
      const imgX = 120;
      const imgY = y + (tHeight - imgSize) / 2;
      ctx.save();
      roundRect(ctx, imgX, imgY, imgSize, imgSize, 10);
      ctx.clip();
      ctx.fillStyle = "#1a2230";
      ctx.fillRect(imgX, imgY, imgSize, imgSize);
      if (trackImgs[i]) ctx.drawImage(trackImgs[i], imgX, imgY, imgSize, imgSize);
      ctx.restore();

      const textX = imgX + imgSize + 22;
      const textMaxW = W - 60 - textX - 20;

      ctx.fillStyle = "#ffffff";
      ctx.font = "600 26px Inter, system-ui";
      ctx.fillText(truncate(ctx, t.name, textMaxW), textX, y + 50);

      ctx.fillStyle = "#8a93a0";
      ctx.font = "400 20px Inter, system-ui";
      const artistsLine = (t.artists || []).map((a) => a.name).join(", ");
      ctx.fillText(truncate(ctx, artistsLine, textMaxW), textX, y + 80);
    });

    ctx.fillStyle = "#5b6573";
    ctx.font = "500 18px Inter, system-ui";
    ctx.fillText("Généré avec Spotify Stats", 60, H - 50);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = `spotify-stats-${range}.png`;
      link.href = url;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  } finally {
    els.exportImage.disabled = false;
    els.exportImage.textContent = originalLabel;
  }
}

// ============================================================
// Création de playlist
// ============================================================

function setPlaylistStatus(msg, { error = false, link = null } = {}) {
  if (!msg) {
    els.playlistStatus.classList.add("hidden");
    els.playlistStatus.textContent = "";
    return;
  }
  els.playlistStatus.classList.remove("hidden");
  els.playlistStatus.classList.toggle("error", error);
  // On évite innerHTML : on construit le DOM, ce qui rend l'XSS impossible
  // même si `msg` venait à contenir du HTML un jour.
  els.playlistStatus.textContent = msg;
  if (link) {
    const safeLink = safeUrl(link);
    if (safeLink !== "#") {
      const a = document.createElement("a");
      a.href = safeLink;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = " Ouvrir →";
      els.playlistStatus.appendChild(a);
    }
  }
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
    // Validation stricte des URIs avant POST : on refuse tout ce qui ne ressemble
    // pas à un identifiant Spotify legit, pour éviter d'injecter n'importe quoi
    // dans la playlist si l'API renvoyait un objet dégradé.
    const uris = tracks
      .map((t) => t.uri)
      .filter(isValidSpotifyTrackUri);
    if (!uris.length) throw new Error("Aucune URI de piste valide à insérer.");
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

// ============================================================
// Explorer : recherche + modal de détail
// ============================================================

let searchTimer = null;
// Token d'annulation : on incrémente à chaque nouvelle requête, et on ignore
// les réponses dont le numéro n'est plus le courant (anti-race-condition).
let searchSeq = 0;
let lastDetailType = null;
let lastDetailId = null;

async function runSearch(query) {
  const q = query.trim().slice(0, SEARCH_QUERY_MAX_LEN);
  if (!q) {
    hideSearchResults();
    return;
  }
  const mySeq = ++searchSeq;
  els.searchResults.classList.remove("hidden");
  els.searchResults.innerHTML = `<div class="search-empty">Recherche…</div>`;
  try {
    const data = await api(
      `/search?q=${encodeURIComponent(q)}&type=artist,album,track&limit=${SEARCH_LIMIT_PER_TYPE}`
    );
    if (mySeq !== searchSeq) return;
    renderSearchResults(data);
  } catch (e) {
    if (mySeq !== searchSeq) return;
    els.searchResults.innerHTML = `<div class="search-empty">Erreur : ${escapeHtml(e.message)}</div>`;
  }
}

function renderSearchResults(data) {
  const artists = data?.artists?.items || [];
  const albums = data?.albums?.items || [];
  const tracks = data?.tracks?.items || [];

  if (!artists.length && !albums.length && !tracks.length) {
    els.searchResults.innerHTML = `<div class="search-empty">Aucun résultat.</div>`;
    return;
  }

  const sections = [];
  if (artists.length) {
    sections.push(renderSearchSection("Artistes", artists.map((a) => ({
      type: "artist",
      id: a.id,
      img: safeImageUrl(a.images?.[a.images.length - 1]?.url),
      title: a.name,
      sub: (a.genres || []).slice(0, 2).join(" · ") || "Artiste",
    }))));
  }
  if (albums.length) {
    sections.push(renderSearchSection("Albums", albums.map((a) => ({
      type: "album",
      id: a.id,
      img: safeImageUrl(a.images?.[a.images.length - 1]?.url),
      title: a.name,
      sub: (a.artists || []).map((x) => x.name).join(", ") + (a.release_date ? ` · ${a.release_date.slice(0, 4)}` : ""),
    }))));
  }
  if (tracks.length) {
    sections.push(renderSearchSection("Titres", tracks.map((t) => ({
      type: "track",
      id: t.id,
      img: safeImageUrl(t.album?.images?.[t.album.images.length - 1]?.url),
      title: t.name,
      sub: (t.artists || []).map((x) => x.name).join(", "),
    }))));
  }
  els.searchResults.innerHTML = sections.join("");
}

function renderSearchSection(label, items) {
  const rows = items.map((it) => `
    <button class="search-item kind-${escapeHtml(it.type)}" role="option" data-detail-type="${escapeHtml(it.type)}" data-detail-id="${escapeHtml(it.id)}">
      ${it.img ? `<img src="${it.img}" alt="" loading="lazy" />` : `<span class="ph"></span>`}
      <div class="meta">
        <div class="si-title">${escapeHtml(it.title)}</div>
        <div class="si-sub">${escapeHtml(it.sub)}</div>
      </div>
    </button>
  `).join("");
  return `<div class="search-section">${escapeHtml(label)}</div>${rows}`;
}

function hideSearchResults() {
  els.searchResults.classList.add("hidden");
  els.searchResults.innerHTML = "";
}

function onSearchInput() {
  const v = els.searchInput.value;
  els.searchClear.classList.toggle("hidden", !v);
  clearTimeout(searchTimer);
  if (!v.trim()) {
    hideSearchResults();
    return;
  }
  searchTimer = setTimeout(() => runSearch(v), SEARCH_DEBOUNCE_MS);
}

function clearSearch() {
  els.searchInput.value = "";
  els.searchClear.classList.add("hidden");
  hideSearchResults();
  els.searchInput.focus();
}

// ---------- Modal ----------

function openModal() {
  els.modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
function closeModal() {
  els.modal.classList.add("hidden");
  els.modalBody.innerHTML = "";
  document.body.style.overflow = "";
  lastDetailType = null;
  lastDetailId = null;
}

function showModalLoader() {
  els.modalBody.innerHTML = `
    <div class="modal-loader">
      <div class="skeleton" style="height:140px"></div>
      <div class="skeleton"></div>
      <div class="skeleton"></div>
      <div class="skeleton"></div>
    </div>`;
}

async function openDetail(type, id) {
  if (!type || !id) return;
  lastDetailType = type;
  lastDetailId = id;
  openModal();
  showModalLoader();
  try {
    if (type === "artist") {
      const [artist, top] = await Promise.all([
        api(`/artists/${encodeURIComponent(id)}`),
        api(`/artists/${encodeURIComponent(id)}/top-tracks?market=from_token`).catch(() => ({ tracks: [] })),
      ]);
      renderArtistDetail(artist, top.tracks || []);
    } else if (type === "album") {
      const album = await api(`/albums/${encodeURIComponent(id)}`);
      renderAlbumDetail(album);
    } else if (type === "track") {
      const track = await api(`/tracks/${encodeURIComponent(id)}`);
      renderTrackDetail(track);
    }
  } catch (e) {
    els.modalBody.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
  }
}

// ---------- Rendus détail ----------

// Indique si l'élément est présent dans le snapshot des tops courants.
function findInTops(kind, id) {
  if (kind === "artist") {
    const idx = (lastSnapshot.artists || []).findIndex((a) => a.id === id);
    return idx >= 0 ? idx + 1 : null;
  }
  if (kind === "track") {
    const idx = (lastSnapshot.tracks || []).findIndex((t) => t.id === id);
    return idx >= 0 ? idx + 1 : null;
  }
  return null;
}

function rangeLabelShort(range) {
  return ({ short_term: "4 sem", medium_term: "6 mois", long_term: "1 an" })[range] || "";
}

function fmtNumber(n) {
  return new Intl.NumberFormat("fr-FR").format(n);
}
function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function renderArtistDetail(artist, topTracks) {
  const cover = safeImageUrl(artist.images?.[0]?.url);
  const spotifyLink = safeUrl(artist.external_urls?.spotify);
  const rank = findInTops("artist", artist.id);

  const trackRows = topTracks.map((t, i) => {
    const img = safeImageUrl(t.album?.images?.[t.album.images.length - 1]?.url);
    const link = safeUrl(t.external_urls?.spotify);
    return `<li class="row">
      <span class="rank">${i + 1}</span>
      ${img ? `<img src="${img}" alt="" loading="lazy" />` : ""}
      <div class="meta">
        <a href="${link}" target="_blank" rel="noopener noreferrer">
          <div class="title">${escapeHtml(t.name)}</div>
        </a>
        <div class="artist">${escapeHtml(t.album?.name || "")}</div>
      </div>
      <span class="when">${fmtDuration(t.duration_ms)}</span>
    </li>`;
  }).join("");

  els.modalBody.innerHTML = `
    <div class="detail-head kind-artist">
      ${cover ? `<img src="${cover}" alt="" class="cover" />` : `<div class="cover"></div>`}
      <div>
        <div class="detail-kind">Artiste</div>
        <h2 id="modal-title" class="detail-name">${escapeHtml(artist.name)}</h2>
        <p class="detail-sub">${escapeHtml((artist.genres || []).slice(0, 3).join(" · ") || "—")}</p>
      </div>
    </div>
    <div class="detail-stats">
      ${rank ? `<span class="in-top-badge">#${rank} dans ton top (${rangeLabelShort(lastSnapshot.range)})</span>` : ""}
      <span class="stat-pill"><strong>${fmtNumber(artist.followers?.total || 0)}</strong> followers</span>
      <span class="stat-pill">Popularité <strong>${artist.popularity ?? 0}/100</strong></span>
    </div>
    <div class="detail-section">
      <h3>Top titres de l'artiste</h3>
      <ol class="detail-list">${trackRows || `<li class="genre-head">Pas de tops disponibles.</li>`}</ol>
    </div>
    <div class="modal-actions">
      <a class="primary" href="${spotifyLink}" target="_blank" rel="noopener noreferrer" style="text-decoration:none; padding:11px 18px; border-radius:10px;">Ouvrir sur Spotify</a>
    </div>
  `;
}

function renderAlbumDetail(album) {
  const cover = safeImageUrl(album.images?.[0]?.url);
  const spotifyLink = safeUrl(album.external_urls?.spotify);
  const artistsLine = (album.artists || []).map((a) => escapeHtml(a.name)).join(", ");
  const totalMs = (album.tracks?.items || []).reduce((sum, t) => sum + (t.duration_ms || 0), 0);

  const trackRows = (album.tracks?.items || []).map((t, i) => {
    const link = safeUrl(t.external_urls?.spotify);
    return `<li class="row">
      <span class="rank">${i + 1}</span>
      <div class="meta">
        <a href="${link}" target="_blank" rel="noopener noreferrer">
          <div class="title">${escapeHtml(t.name)}</div>
        </a>
        <div class="artist">${(t.artists || []).map((a) => escapeHtml(a.name)).join(", ")}</div>
      </div>
      <span class="when">${fmtDuration(t.duration_ms)}</span>
    </li>`;
  }).join("");

  els.modalBody.innerHTML = `
    <div class="detail-head">
      ${cover ? `<img src="${cover}" alt="" class="cover" />` : `<div class="cover"></div>`}
      <div>
        <div class="detail-kind">Album · ${escapeHtml(album.album_type || "album")}</div>
        <h2 id="modal-title" class="detail-name">${escapeHtml(album.name)}</h2>
        <p class="detail-sub">${artistsLine}</p>
      </div>
    </div>
    <div class="detail-stats">
      <span class="stat-pill">Sorti <strong>${escapeHtml(album.release_date || "?")}</strong></span>
      <span class="stat-pill"><strong>${album.total_tracks || 0}</strong> titres</span>
      <span class="stat-pill">Durée <strong>${fmtDuration(totalMs)}</strong></span>
      ${album.label ? `<span class="stat-pill">${escapeHtml(album.label)}</span>` : ""}
      <span class="stat-pill">Popularité <strong>${album.popularity ?? 0}/100</strong></span>
    </div>
    <div class="detail-section">
      <h3>Pistes</h3>
      <ol class="detail-list">${trackRows}</ol>
    </div>
    <div class="modal-actions">
      <a class="primary" href="${spotifyLink}" target="_blank" rel="noopener noreferrer" style="text-decoration:none; padding:11px 18px; border-radius:10px;">Ouvrir sur Spotify</a>
    </div>
  `;
}

function renderTrackDetail(track) {
  const cover = safeImageUrl(track.album?.images?.[0]?.url);
  const spotifyLink = safeUrl(track.external_urls?.spotify);
  const artistsLine = (track.artists || []).map((a) => escapeHtml(a.name)).join(", ");
  const rank = findInTops("track", track.id);

  els.modalBody.innerHTML = `
    <div class="detail-head">
      ${cover ? `<img src="${cover}" alt="" class="cover" />` : `<div class="cover"></div>`}
      <div>
        <div class="detail-kind">Titre</div>
        <h2 id="modal-title" class="detail-name">${escapeHtml(track.name)}</h2>
        <p class="detail-sub">${artistsLine}</p>
        <p class="detail-sub">Sur <strong>${escapeHtml(track.album?.name || "—")}</strong></p>
      </div>
    </div>
    <div class="detail-stats">
      ${rank ? `<span class="in-top-badge">#${rank} dans ton top (${rangeLabelShort(lastSnapshot.range)})</span>` : ""}
      <span class="stat-pill">Durée <strong>${fmtDuration(track.duration_ms)}</strong></span>
      <span class="stat-pill">Popularité <strong>${track.popularity ?? 0}/100</strong></span>
      ${track.explicit ? `<span class="stat-pill">Explicit</span>` : ""}
      ${track.album?.release_date ? `<span class="stat-pill">Sorti <strong>${escapeHtml(track.album.release_date)}</strong></span>` : ""}
    </div>
    <div class="modal-actions">
      <a class="primary" href="${spotifyLink}" target="_blank" rel="noopener noreferrer" style="text-decoration:none; padding:11px 18px; border-radius:10px;">Ouvrir sur Spotify</a>
    </div>
  `;
}

// ============================================================
// Routage
// ============================================================

function showSection(name) {
  els.notConfigured.classList.toggle("hidden", name !== "not-configured");
  els.login.classList.toggle("hidden", name !== "login");
  els.app.classList.toggle("hidden", name !== "app");
}

async function boot() {
  // 1) Retour OAuth ?
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    showError(`Spotify a refusé l'auth : ${oauthError}`);
  }

  if (code) {
    const expectedState = store.oauthState;
    if (!looksLikeOauthCode(code)) {
      showError("Code OAuth invalide reçu — auth annulée.");
    } else if (!expectedState || returnedState !== expectedState) {
      // State manquant ou différent → soit la session a sauté, soit on est
      // ciblé par une CSRF. Dans les deux cas on refuse d'échanger le code.
      showError("État OAuth invalide — probable tentative CSRF, auth annulée.");
    } else {
      try {
        await exchangeCodeForToken(code);
      } catch (e) {
        showError(e.message);
      }
    }
    store.clearOauthEphemeral();
    // On vire le code de la barre d'URL (et donc de l'historique).
    window.history.replaceState({}, document.title, REDIRECT_URI);
  }

  // 2) Config présente ?
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

// ============================================================
// Wiring des évènements
// ============================================================

els.loginBtn.addEventListener("click", () => {
  clearError();
  startLogin().catch((e) => showError(e.message));
});

els.logoutBtn.addEventListener("click", () => {
  store.clearTokens();
  store.clearOauthEphemeral();
  stopNowPlaying();
  showSection("login");
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopNowPlaying();
  else if (store.accessToken && !els.app.classList.contains("hidden")) startNowPlaying();
});

els.tabs.forEach((t) => {
  t.addEventListener("click", () => loadRange(t.dataset.range));
});

els.themeToggle.addEventListener("click", toggleTheme);
els.savePlaylist.addEventListener("click", createPlaylistFromTopTracks);
els.exportImage.addEventListener("click", exportAsImage);
wireExpandToggles();

// ---------- Wiring de la recherche ----------
els.searchInput.addEventListener("input", onSearchInput);
els.searchInput.addEventListener("focus", () => {
  if (els.searchResults.innerHTML.trim()) els.searchResults.classList.remove("hidden");
});
els.searchClear.addEventListener("click", clearSearch);

// Click sur un résultat → on délègue, plus simple que d'attacher N listeners.
els.searchResults.addEventListener("click", (e) => {
  const btn = e.target.closest(".search-item");
  if (!btn) return;
  const type = btn.dataset.detailType;
  const id = btn.dataset.detailId;
  hideSearchResults();
  openDetail(type, id);
});

// Click en dehors de la search-wrap : on referme les résultats.
document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-wrap")) hideSearchResults();
});

// ---------- Wiring du modal ----------
els.modalCloseTriggers.forEach((el) => el.addEventListener("click", closeModal));
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!els.modal.classList.contains("hidden")) {
    closeModal();
  } else if (!els.searchResults.classList.contains("hidden")) {
    hideSearchResults();
    els.searchInput.blur();
  }
});

boot();
