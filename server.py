"""LIFEVEST local dev server.

Serves static files from this directory and provides /login and /register
endpoints backed by a local SQLite database.

Run:
    python3 server.py
    # then open http://localhost:9999/

Override the database location with LIFEVEST_DB_PATH, e.g.
    LIFEVEST_DB_PATH=~/Desktop/lifevest.db python3 server.py
"""
import hashlib
import json
import os
import sqlite3
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from typing import Optional

DB_PATH = Path(os.environ.get("LIFEVEST_DB_PATH", "userdata.db")).expanduser()
PORT = int(os.environ.get("PORT", "9999"))


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS userdata (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL
            )
            """
        )


def _hash(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


class Handler(SimpleHTTPRequestHandler):
    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> Optional[dict]:
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            return json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return None

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self) -> None:
        if self.path == "/login":
            return self._handle_login()
        if self.path == "/register":
            return self._handle_register()
        self._json(404, {"message": "Not Found"})

    def _handle_login(self) -> None:
        data = self._read_json()
        if data is None:
            return self._json(400, {"message": "Invalid JSON data"})
        username = (data.get("username") or "").strip()
        password = data.get("password") or ""
        if not username or not password:
            return self._json(400, {"message": "Username and password required"})
        with sqlite3.connect(DB_PATH) as conn:
            row = conn.execute(
                "SELECT password FROM userdata WHERE username = ?", (username,)
            ).fetchone()
        if row and row[0] == _hash(password):
            return self._json(200, {"message": "Login Successful"})
        self._json(401, {"message": "Invalid username or password"})

    def _handle_register(self) -> None:
        data = self._read_json()
        if data is None:
            return self._json(400, {"message": "Invalid JSON data"})
        username = (data.get("username") or "").strip()
        password = data.get("password") or ""
        if not username or not password:
            return self._json(400, {"message": "Username and password required"})
        if len(password) < 6:
            return self._json(400, {"message": "Password must be at least 6 characters"})
        try:
            with sqlite3.connect(DB_PATH) as conn:
                conn.execute(
                    "INSERT INTO userdata (username, password) VALUES (?, ?)",
                    (username, _hash(password)),
                )
        except sqlite3.IntegrityError:
            return self._json(409, {"message": "Username already exists"})
        self._json(201, {"message": "Registration Successful"})


def main() -> None:
    init_db()
    print(f"LIFEVEST server on http://localhost:{PORT}/  (db: {DB_PATH})")
    HTTPServer(("", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
