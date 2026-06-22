# Spotify Stats — local

Petite app web qui affiche tes top artistes & top titres Spotify sur 3 périodes :
- 4 semaines (`short_term`)
- 6 mois (`medium_term`)
- 1 an (`long_term`)

100% statique, aucun serveur, aucun secret partagé. Tout reste dans ton navigateur.

## 1) Créer une app Spotify (une fois, 2 min)

1. Va sur https://developer.spotify.com/dashboard et clique **Create app**.
2. Remplis n'importe quoi pour le nom / description.
3. Dans **Redirect URIs**, ajoute EXACTEMENT :

   ```
   http://127.0.0.1:8888/
   ```

4. Coche **Web API**. Sauvegarde.
5. Copie le **Client ID** (tu en auras besoin au premier lancement).

> Pas besoin du Client Secret — on utilise le flow PKCE.

## 2) Lancer l'app

Depuis le dossier `spotify-stats` :

### macOS / Linux
```bash
python3 -m http.server 8888 --bind 127.0.0.1
```

### Windows
```powershell
python -m http.server 8888 --bind 127.0.0.1
```

Puis ouvre **http://127.0.0.1:8888/** dans ton navigateur.

Au premier lancement :
- colle ton Client ID,
- clique **Se connecter avec Spotify**,
- accepte les permissions,
- profite.

## Notes

- Les tokens sont stockés en `localStorage` (Client ID + access/refresh token).
- "Déconnexion" supprime les tokens, "Changer de Client ID" purge tout.
- L'API Spotify ne propose pas de "1 semaine" ni de "all time" depuis fin 2024, d'où les 3 périodes ci-dessus.
- Si tu changes de port, mets à jour le Redirect URI dans le dashboard Spotify.
