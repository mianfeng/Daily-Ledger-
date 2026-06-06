#!/usr/bin/env python3
from __future__ import annotations

import base64
import hashlib
import http.cookies
import http.server
import json
import mimetypes
import os
import secrets
import shutil
import socketserver
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


REPO_ROOT = Path(__file__).resolve().parent.parent
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "3000"))
DATA_DIR = Path(os.environ.get("DATA_DIR", REPO_ROOT / "data")).resolve()
BACKUP_DIR = Path(os.environ.get("BACKUP_DIR", REPO_ROOT / "backups")).resolve()
LEDGER_PATH = DATA_DIR / "ledger.json"
SESSIONS_PATH = DATA_DIR / "sessions.json"
DIST_DIR = REPO_ROOT / "dist"
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD_HASH = os.environ.get("ADMIN_PASSWORD_HASH", "")
SESSION_TTL_DAYS = int(os.environ.get("SESSION_TTL_DAYS", "30"))
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "").lower() == "true"
COOKIE_NAME = "daily_ledger_session"
MAX_BODY_BYTES = 5 * 1024 * 1024


DATA_DIR.mkdir(parents=True, exist_ok=True)
BACKUP_DIR.mkdir(parents=True, exist_ok=True)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def read_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def write_json_atomic(path: Path, value: Any) -> None:
    tmp = path.with_name(f"{path.name}.{os.getpid()}.{int(time.time() * 1000)}.tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def is_record(value: Any) -> bool:
    return isinstance(value, dict)


def is_ledger_data(value: Any) -> bool:
    return is_record(value) and is_record(value.get("copper")) and is_record(value.get("daily"))


def verify_password(password: str, stored_hash: str) -> bool:
    parts = stored_hash.split(":")
    if len(parts) != 3 or parts[0] != "scrypt":
        return False
    _algorithm, salt_hex, expected_hex = parts
    try:
        actual = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt_hex.encode("utf-8"),
            n=16384,
            r=8,
            p=1,
            dklen=64,
        )
        expected = bytes.fromhex(expected_hex)
    except Exception:
        return False
    return secrets.compare_digest(actual, expected)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def get_state() -> dict[str, Any]:
    state = read_json(LEDGER_PATH, None)
    if not is_record(state) or not is_ledger_data(state.get("data")):
        return {"hasData": False, "data": None, "revision": 0, "updatedAt": None}
    return {
        "hasData": True,
        "data": state["data"],
        "revision": int(state.get("revision") or 0),
        "updatedAt": state.get("updatedAt"),
    }


def save_state(data: Any, expected_revision: Any) -> dict[str, Any]:
    if not is_ledger_data(data):
        raise ApiError(400, "Invalid ledger data.")
    try:
        expected = int(expected_revision)
    except Exception as exc:
        raise ApiError(400, "A valid revision is required.") from exc
    if expected < 0:
        raise ApiError(400, "A valid revision is required.")

    existing = get_state()
    if existing["hasData"] and existing["revision"] != expected:
        raise ApiError(
            409,
            "Ledger data changed on another device.",
            {"currentRevision": existing["revision"]},
        )
    if not existing["hasData"] and expected != 0:
        raise ApiError(409, "Ledger data does not exist yet.", {"currentRevision": 0})

    next_state = {
        "data": data,
        "revision": existing["revision"] + 1 if existing["hasData"] else 1,
        "updatedAt": now_iso(),
    }
    write_json_atomic(LEDGER_PATH, next_state)
    return {"hasData": True, **next_state}


def read_sessions() -> dict[str, Any]:
    sessions = read_json(SESSIONS_PATH, {})
    return sessions if is_record(sessions) else {}


def write_sessions(sessions: dict[str, Any]) -> None:
    write_json_atomic(SESSIONS_PATH, sessions)


def prune_sessions() -> dict[str, Any]:
    sessions = read_sessions()
    current = time.time()
    changed = False
    for token_hash, session in list(sessions.items()):
        if not is_record(session) or float(session.get("expiresAt", 0)) <= current:
            del sessions[token_hash]
            changed = True
    if changed:
        write_sessions(sessions)
    return sessions


def create_backup_payload(state: dict[str, Any]) -> dict[str, Any]:
    return {
        "version": 1,
        "exportedAt": now_iso(),
        "origin": "server",
        "copper": state["data"]["copper"],
        "daily": state["data"]["daily"],
    }


def prune_backups() -> None:
    files = sorted(BACKUP_DIR.glob("????-??-??.json"))
    for file in files[:-30]:
        file.unlink(missing_ok=True)


def run_daily_backup() -> str | None:
    state = get_state()
    if not state["hasData"]:
        return None
    file = BACKUP_DIR / f"{datetime.now().strftime('%Y-%m-%d')}.json"
    if not file.exists():
        file.write_text(
            json.dumps(create_backup_payload(state), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    prune_backups()
    return file.name


class ApiError(Exception):
    def __init__(self, status: int, message: str, extra: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.message = message
        self.extra = extra or {}


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "DailyLedger/1.0"

    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.address_string()} - {format % args}", flush=True)

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length > MAX_BODY_BYTES:
            raise ApiError(413, "Request body is too large.")
        if length == 0:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception as exc:
            raise ApiError(400, "Invalid JSON body.") from exc

    def cookie_token(self) -> str | None:
        raw = self.headers.get("Cookie")
        if not raw:
            return None
        cookie = http.cookies.SimpleCookie()
        cookie.load(raw)
        morsel = cookie.get(COOKIE_NAME)
        return morsel.value if morsel else None

    def is_authenticated(self) -> bool:
        token = self.cookie_token()
        if not token:
            return False
        session = prune_sessions().get(hash_token(token))
        return is_record(session) and float(session.get("expiresAt", 0)) > time.time()

    def require_auth(self) -> None:
        if not self.is_authenticated():
            raise ApiError(401, "Authentication required.")

    def set_session_cookie(self, token: str, max_age: int | None = None) -> None:
        parts = [
            f"{COOKIE_NAME}={token}",
            "Path=/",
            "HttpOnly",
            "SameSite=Lax",
        ]
        if max_age is not None:
            parts.append(f"Max-Age={max_age}")
        if COOKIE_SECURE:
            parts.append("Secure")
        self.send_header("Set-Cookie", "; ".join(parts))

    def create_session(self) -> None:
        token = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("ascii").rstrip("=")
        sessions = prune_sessions()
        sessions[hash_token(token)] = {
            "expiresAt": time.time() + SESSION_TTL_DAYS * 24 * 60 * 60,
            "createdAt": now_iso(),
        }
        write_sessions(sessions)
        self.set_session_cookie(token, SESSION_TTL_DAYS * 24 * 60 * 60)

    def clear_session(self) -> None:
        token = self.cookie_token()
        if token:
            sessions = read_sessions()
            sessions.pop(hash_token(token), None)
            write_sessions(sessions)
        self.set_session_cookie("", 0)

    def handle_api(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path

        if self.command == "GET" and path == "/api/health":
            self.send_json(200, {"ok": True})
            return

        if self.command == "GET" and path == "/api/auth/session":
            self.send_json(200, {"authenticated": self.is_authenticated()})
            return

        if self.command == "POST" and path == "/api/auth/login":
            body = self.read_body_json()
            if (
                body.get("username") != ADMIN_USERNAME
                or not isinstance(body.get("password"), str)
                or not verify_password(body["password"], ADMIN_PASSWORD_HASH)
            ):
                self.send_json(401, {"error": "Invalid username or password."})
                return
            body_bytes = json.dumps({"authenticated": True}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body_bytes) + 1))
            self.create_session()
            self.end_headers()
            self.wfile.write(body_bytes + b"\n")
            return

        if self.command == "POST" and path == "/api/auth/logout":
            body_bytes = json.dumps({"authenticated": False}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body_bytes) + 1))
            self.clear_session()
            self.end_headers()
            self.wfile.write(body_bytes + b"\n")
            return

        if self.command == "GET" and path == "/api/ledger":
            self.require_auth()
            self.send_json(200, get_state())
            return

        if self.command == "PUT" and path == "/api/ledger":
            self.require_auth()
            body = self.read_body_json()
            self.send_json(200, save_state(body.get("data"), body.get("revision")))
            return

        if self.command == "POST" and path == "/api/ledger/import":
            self.require_auth()
            body = self.read_body_json()
            if body.get("requireEmpty") and get_state()["hasData"]:
                self.send_json(
                    409,
                    {
                        "error": "Server already has ledger data.",
                        "currentRevision": get_state()["revision"],
                    },
                )
                return
            self.send_json(200, save_state(body.get("data"), body.get("revision", 0)))
            return

        if self.command == "GET" and path == "/api/ledger/export":
            self.require_auth()
            state = get_state()
            if not state["hasData"]:
                self.send_json(404, {"error": "No ledger data to export."})
                return
            body = (
                json.dumps(create_backup_payload(state), ensure_ascii=False, indent=2) + "\n"
            ).encode("utf-8")
            file_name = f"daily-ledger-backup_{datetime.now().strftime('%Y%m%d%H%M')}.json"
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Disposition", f'attachment; filename="{file_name}"')
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if self.command == "POST" and path == "/api/backups/run":
            self.require_auth()
            self.send_json(200, {"ok": True, "file": run_daily_backup()})
            return

        self.send_json(404, {"error": "Not found."})

    def send_static(self) -> None:
        parsed = urlparse(self.path)
        relative = "index.html" if parsed.path == "/" else parsed.path.lstrip("/")
        requested = (DIST_DIR / relative).resolve()
        if not str(requested).startswith(str(DIST_DIR.resolve())):
            self.send_error(403)
            return
        file_path = requested if requested.is_file() else DIST_DIR / "index.html"
        if not file_path.is_file():
            self.send_error(404)
            return
        content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(file_path.stat().st_size))
        self.end_headers()
        with file_path.open("rb") as file:
            shutil.copyfileobj(file, self.wfile)

    def do_GET(self) -> None:
        self.route()

    def do_POST(self) -> None:
        self.route()

    def do_PUT(self) -> None:
        self.route()

    def route(self) -> None:
        try:
            if urlparse(self.path).path.startswith("/api/"):
                self.handle_api()
            else:
                self.send_static()
        except ApiError as error:
            self.send_json(error.status, {"error": error.message, **error.extra})
        except Exception as error:
            self.send_json(500, {"error": str(error) or "Unexpected server error."})


class ThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


if __name__ == "__main__":
    run_daily_backup()
    with ThreadingServer((HOST, PORT), Handler) as server:
        print(f"Daily Ledger Python server listening on {HOST}:{PORT}", flush=True)
        print(f"Ledger data file: {LEDGER_PATH}", flush=True)
        server.serve_forever()
