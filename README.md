# Spotify Stats

SPA statique, sans backend, qui affiche tes **top artistes**, **top titres**, **top genres**, **derniers titres écoutés** et le titre **en cours d'écoute** sur Spotify, sur 3 périodes (4 semaines, 6 mois, 1 an). Export en un clic de ton top en PNG prêt pour Instagram ou en playlist Spotify privée. Authentification via le flow **OAuth 2.0 PKCE** — les tokens vivent uniquement dans ton navigateur, rien n'est envoyé à un serveur tiers.

## Fonctionnalités

- Top 50 artistes, top 50 titres, top 12 genres par période
- Widget « en cours d'écoute » avec rafraîchissement automatique
- Récemment écoutés (50 derniers titres) avec dates relatives
- Recherche libre artistes / albums / titres / playlists avec modal détail
- Photo de profil Spotify dans le header
- Thème clair / sombre avec détection des préférences système
- Sauvegarde du top courant en playlist Spotify privée
- Export du top en carte PNG 1080×1350 (format Instagram 4:5)

## Setup (une fois, ~2 min)

1. Va sur https://developer.spotify.com/dashboard et clique **Create app**.
2. Mets n'importe quel nom / description.
3. Dans **Redirect URIs**, ajoute exactement :
   ```
   http://127.0.0.1:8888/
   ```
   (le `/` final est important)
4. Coche **Web API**, puis **Save**.
5. Copie le **Client ID** et colle-le dans [`config.js`](./config.js) à la racine :
   ```js
   window.SPOTIFY_CONFIG = {
     CLIENT_ID: "ton-client-id-ici",
     ...
   };
   ```

> Pas besoin du Client Secret — PKCE s'en occupe.

## Lancer en local

Depuis la racine du projet :

### macOS / Linux
```bash
./start.sh
```

### Windows
```bat
start.bat
```

Les deux scripts démarrent un serveur HTTP Python local sur le port 8888 et ouvrent `http://127.0.0.1:8888/` dans ton navigateur.

## Déploiement

Le repo contient un [`vercel.json`](./vercel.json) qui pose des headers de sécurité stricts (CSP, Permissions-Policy, X-Frame-Options) adaptés au flow OAuth Spotify + CDN.

```bash
npm i -g vercel       # une fois
vercel login          # une fois
vercel --prod         # depuis la racine du projet
```

Après le premier déploiement, copie l'URL Vercel (ex : `https://spotify-stats-xxx.vercel.app/`) et ajoute-la aux **Redirect URIs** sur le dashboard Spotify, à côté de `http://127.0.0.1:8888/`. Spotify accepte plusieurs URIs, donc tu peux continuer à bosser en local sans rien casser.

### Passer en mode public pour tout le monde (Extended Quota Mode)

Par défaut, une app Spotify est en **Development Mode** et seuls les 25 utilisateurs que tu ajoutes manuellement dans le dashboard peuvent se connecter. Pour ouvrir à n'importe qui, il faut faire une demande de **Extended Quota Mode** depuis le dashboard de ton app. La review prend généralement 1 à 3 semaines. Le formulaire te demandera :

- Une URL publique de **Privacy Policy** → [`/privacy.html`](./privacy.html)
- Une URL publique de **Terms of Service** → [`/terms.html`](./terms.html)
- Une courte vidéo de démo (1–2 min de Loom suffisent)
- L'URL de l'app déployée avec un flow de connexion fonctionnel

## Notes

- L'API Web de Spotify n'expose que 3 périodes : `short_term` (~4 semaines), `medium_term` (~6 mois), `long_term` (~1 an). Le vrai « all time » n'existe plus depuis fin 2024.
- Les tokens sont stockés dans `localStorage`. La **déconnexion** les efface.
- Sans approbation **Extended Quota Mode** de Spotify, ton app reste en Development Mode et seuls les 25 utilisateurs que tu ajoutes manuellement dans le dashboard peuvent se connecter.
- Les endpoints `/audio-features`, `/related-artists` et `/recommendations` ont été dépréciés par Spotify le 27 novembre 2024 pour les apps créées après. Cette app n'en dépend pas.
