import hashlib
import json
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _kv import KVNotConfigured, setnx as kv_setnx


def _hash(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


class handler(BaseHTTPRequestHandler):
    def _respond(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
            data = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._respond(400, {"message": "Invalid JSON data"})

        username = (data.get("username") or "").strip()
        password = data.get("password") or ""
        if not username or not password:
            return self._respond(400, {"message": "Username and password required"})
        if len(password) < 6:
            return self._respond(400, {"message": "Password must be at least 6 characters"})

        try:
            created = kv_setnx(f"user:{username}", _hash(password))
        except KVNotConfigured as e:
            return self._respond(503, {"message": str(e)})
        except Exception as e:
            return self._respond(500, {"message": "Internal Server Error", "error": str(e)})

        if not created:
            return self._respond(409, {"message": "Username already exists."})
        return self._respond(201, {"message": "Registration Successful"})
