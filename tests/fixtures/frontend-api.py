#!/usr/bin/env python3
"""Bounded loopback API fixture for disposable frontend/host verification."""
from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
import secrets
import threading

MAX_HEADER_BYTES = 16 * 1024
MAX_BODY_BYTES = 64 * 1024
MAX_RESPONSE_BYTES = 10 * 1024 * 1024
SNAPSHOT_PATH = "/api/local/mc-project-plugin/projects/snapshot"
CATALOG_PATH = "/api/local/mc-project-plugin/projects/catalog"


def envelope(data: object) -> dict[str, object]:
    return {
        "ok": True,
        "data": data,
        "meta": {
            "schemaVersion": 1,
            "requestId": secrets.token_urlsafe(18),
            "observedAt": "2026-09-14T10:00:00+00:00",
        },
    }


def load_fixture(path: Path) -> dict[str, object]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("ok") is not True or not isinstance(value.get("data"), dict):
        raise ValueError("fixture must be an {ok:true,data:{...}} envelope")
    return value


def json_bytes(value: object) -> bytes:
    body = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(body) > MAX_RESPONSE_BYTES:
        raise ValueError("fixture response exceeds MAX_RESPONSE_BYTES")
    return body


class BoundedHTTPServer(ThreadingHTTPServer):
    request_queue_size = 16

    def __init__(self, server_address: tuple[str, int], handler):
        super().__init__(server_address, handler)
        self._connection_slots = threading.BoundedSemaphore(16)
        self.daemon_threads = True

    def process_request(self, request, client_address):  # type: ignore[no-untyped-def]
        if not self._connection_slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self._connection_slots.release()
            raise

    def process_request_thread(self, request, client_address):  # type: ignore[no-untyped-def]
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._connection_slots.release()


def make_handler(snapshot: dict[str, object]):
    data = snapshot["data"]
    assert isinstance(data, dict)
    project_id = data.get("project_id")
    project = data.get("project")
    assert isinstance(project_id, str) and isinstance(project, dict)
    catalog = [{
        "project_id": project_id,
        "name": project.get("name", "Demo"),
        "enabled": True,
        "remote": "origin",
        "default_branch": "main",
    }]

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *_args: object) -> None:
            return

        def _send(self, status: int, payload: object) -> None:
            body = json_bytes(payload)
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)
            self.close_connection = True

        def do_GET(self) -> None:  # noqa: N802 - stdlib handler contract
            if len(str(self.headers)) > MAX_HEADER_BYTES:
                self._send(431, {"ok": False, "error": "REQUEST_HEADERS_TOO_LARGE"})
                return
            try:
                body_length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self._send(400, {"ok": False, "error": "INVALID_REQUEST"})
                return
            if body_length < 0 or body_length > MAX_BODY_BYTES:
                self._send(413, {"ok": False, "error": "OUTPUT_LIMIT"})
                return
            if body_length:
                self.rfile.read(body_length)
            parsed = urlsplit(self.path)
            if parsed.path == "/health":
                self._send(200, {"ok": True, "data": {"status": "ready"}})
                return
            if parsed.path == CATALOG_PATH and not parsed.query:
                self._send(200, envelope(catalog))
                return
            if parsed.path == SNAPSHOT_PATH:
                params = parse_qs(parsed.query, keep_blank_values=True)
                values = params.get("project_id", [])
                if set(params) != {"project_id"} or len(values) != 1 or values[0] != project_id:
                    self._send(400, {"ok": False, "error": "INVALID_REQUEST"})
                    return
                self._send(200, snapshot)
                return
            self._send(404, {"ok": False, "error": "NOT_FOUND"})

    return Handler


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", required=True, type=Path)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", required=True, type=int)
    parser.add_argument("--allow-anonymous-loopback", action="store_true")
    args = parser.parse_args()
    if not args.allow_anonymous_loopback or args.bind not in {"127.0.0.1", "localhost", "::1"}:
        parser.error("this fixture only permits --allow-anonymous-loopback on loopback")
    snapshot = load_fixture(args.fixture)
    server = BoundedHTTPServer((args.bind, args.port), make_handler(snapshot))
    server.daemon_threads = True
    server.timeout = 1.0
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        return 0
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
