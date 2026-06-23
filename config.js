'use strict';

// Configuration publique. Le Client ID Spotify est PUBLIC par design (PKCE
// protège la confidentialité de l'auth via le code verifier), donc on peut
// le commiter sans risque. Le client_secret, lui, ne doit JAMAIS être ici.

window.SPOTIFY_CONFIG = {
  CLIENT_ID: '10a7f851196e4dc9acf3fce26a988dc4',
  SCOPES: [
    'user-top-read',
    'user-read-recently-played',
    'user-read-currently-playing',
    'user-read-playback-state',
    'playlist-modify-private',
    'playlist-modify-public',
  ].join(' '),
};
