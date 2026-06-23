#!/usr/bin/env python3
"""Petit serveur HTTP local qui force le no-cache.

`python3 -m http.server` ne pose aucun header anti-cache, donc le
navigateur garde en RAM les anciennes versions de config.js / app.js /
styles.css. C'est très chiant en dev parce qu'éditer un fichier ne se
voit pas tant qu'on ne fait pas un hard-reload manuel — et même là
certains caches résistent.

Ce wrapper ajoute Cache-Control: no-store sur toutes les réponses, ce
qui garantit qu'à chaque navigation/refresh on relit le fichier sur
disque.
"""

import http.server
import socketserver
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8888
    with socketserver.TCPServer(("127.0.0.1", port), NoCacheHandler) as httpd:
        httpd.allow_reuse_address = True
        print(f"→ Spotify Stats sur http://127.0.0.1:{port}/  (no-cache)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n→ Arrêt.")
