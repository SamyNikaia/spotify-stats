// Public configuration. Safe to commit — the Spotify Client ID is meant to be public.
// Replace CLIENT_ID with the value from https://developer.spotify.com/dashboard.

window.SPOTIFY_CONFIG = {
  CLIENT_ID: "",
  SCOPES: [
    "user-top-read",
    "user-read-recently-played",
    "user-read-currently-playing",
    "user-read-playback-state",
    "playlist-modify-private",
    "playlist-modify-public",
  ].join(" "),
};
