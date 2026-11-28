"""Single-user same-origin review-only manufacturing service; not a public API."""
import argparse
import base64
import hmac
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import threading
from socketserver import ThreadingMixIn
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlsplit
import zipfile

ROOT = Path(__file__).resolve().parents[1]
API = "/api/manufacture"
MAX_INPUT = 2_000_000
MAX_RESULT = 32 * 1024 * 1024
MAX_CONNECTIONS = 8
FILES = ("Gerber.zip", "BOM.csv", "CPL.csv", "DO_NOT_ORDER.txt",
         "validation.json", "erc.json", "drc.json")


class BoundedHTTPServer(ThreadingMixIn, HTTPServer):
    """Bound concurrent request threads; never queue unbounded work in Python."""
    request_queue_size = MAX_CONNECTIONS
    daemon_threads = False
    block_on_close = True

    def __init__(self, *args, max_connections=MAX_CONNECTIONS, **kwargs):
        if max_connections < 1:
            raise ValueError("max_connections must be positive")
        self._slots = threading.BoundedSemaphore(max_connections)
        super().__init__(*args, **kwargs)

    def process_request(self, request, client_address):
        if not self._slots.acquire(blocking=False):
            # A trusted proxy should apply connection/rate limits before this.
            # Do not allocate another thread or parse an overloaded connection.
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self._slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._slots.release()


class Rejected(Exception):
    pass


def run_stage(command, cwd, env):
    with subprocess.Popen(command, cwd=cwd, env=env, stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL, start_new_session=True) as proc:
        try:
            return proc.wait(timeout=180)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()
            raise Rejected("Manufacturing stage timed out")


def read_json(path):
    if path.stat().st_size > MAX_RESULT:
        raise Rejected("Diagnostic exceeds size limit")
    return json.loads(path.read_text(encoding="utf-8"))


def audit_gerber_archive(path):
    """Check the delivery archive, not the physical design (KiCad does that)."""
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            names = [entry.filename for entry in entries]
            if (not entries or len(names) != len(set(names))
                    or any(entry.is_dir() or '/' in entry.filename or '\\' in entry.filename
                           or entry.filename in ('.', '..') or not entry.file_size for entry in entries)
                    or sum(entry.file_size for entry in entries) > MAX_RESULT):
                raise Rejected("Invalid Gerber archive contents")
            # KiCad can use Protel extensions instead of .gbr. Identify top
            # copper using the X2 file-function attribute.
            top = False
            outline = False
            for name in names:
                lower = name.lower()
                suffix = Path(lower).suffix
                if suffix in ('.gtl', '.gbr'):
                    data = archive.read(name)
                    top |= b'TF.FileFunction,Copper,L1,Top' in data
                if suffix == '.gko' or 'edge_cuts' in lower or 'edge.cuts' in lower:
                    outline = True
            if not top or not outline or archive.testzip() is not None:
                raise Rejected("Missing or corrupt top copper/outline Gerber output")
    except (zipfile.BadZipFile, RuntimeError, NotImplementedError) as exc:
        raise Rejected("Invalid Gerber ZIP") from exc


def audit_assembly_delivery(draft, source):
    """Require exact source reference parity in each delivered assembly CSV."""
    parts = json.loads(source).get("components")
    if not isinstance(parts, list) or not parts:
        raise Rejected("Missing source components")
    refs = [part.get("ref") for part in parts if isinstance(part, dict)]
    if (len(refs) != len(parts) or any(not isinstance(ref, str) or not ref for ref in refs)
            or len(set(refs)) != len(refs)):
        raise Rejected("Invalid source component references")
    for name in ("BOM.csv", "CPL.csv"):
        try:
            with (draft / name).open(encoding="utf-8-sig", newline="") as stream:
                rows = csv.DictReader(stream)
                if not rows.fieldnames or rows.fieldnames.count("Designator") != 1:
                    raise Rejected(name + " missing unique Designator column")
                actual = [row.get("Designator") for row in rows]
        except (UnicodeError, csv.Error) as exc:
            raise Rejected(name + " invalid CSV") from exc
        if len(actual) != len(refs) or set(actual) != set(refs):
            raise Rejected(name + " source reference mismatch")


def stage_diagnostic(path, key, work):
    """Expose bounded, job-local diagnostics, never arbitrary process logs."""
    try:
        values = read_json(path).get(key, [])
        if not isinstance(values, list):
            return ""
        return "; ".join(str(value) for value in values[:10]).replace(str(work), "[job]")[:1500]
    except (OSError, ValueError, TypeError, AttributeError):
        return ""


def bundle(board, source):
    summary = read_json(board / "project.json")
    validation = read_json(board / "validation.json")
    if (summary.get("status") != "draft" or summary.get("orderReady") is not False
            or validation.get("orderReady") is not False):
        raise Rejected("No independently checked draft")
    paths = [board / "draft" / name for name in FILES]
    if any(not p.is_file() or p.is_symlink() or not p.stat().st_size for p in paths):
        raise Rejected("Incomplete draft")
    if sum(p.stat().st_size for p in paths) + len(source) > MAX_RESULT:
        raise Rejected("Draft exceeds size limit")
    audit_gerber_archive(board / "draft" / "Gerber.zip")
    audit_assembly_delivery(board / "draft", source)
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in paths:
            archive.write(path, path.name)
        archive.writestr("source-project.json", source)
        archive.writestr("source-sha256.txt", hashlib.sha256(source).hexdigest() + "\n")
    return output.getvalue()


def manufacture(source):
    try:
        project = json.loads(source)
        if not isinstance(project, dict) or project.get("schemaVersion") != 1:
            raise ValueError()
    except (ValueError, UnicodeError, RecursionError):
        raise Rejected("Invalid schema-v1 JSON")
    with tempfile.TemporaryDirectory(prefix="pcbwb-job-") as directory:
        work = Path(directory)
        input_path = work / "input.json"
        input_path.write_bytes(source)
        out = work / "output"
        env = {k: v for k, v in os.environ.items() if not k.startswith("PCBWB_")}
        env.update(PCBWB_PRIVATE_OUTPUT=str(out), PCBWB_ZONE_FILL="1", QT_QPA_PLATFORM="offscreen")
        board = out / "projects" / "native"
        if run_stage(["bun", "run", str(ROOT / "scripts/build.tsx"), "--project-json", str(input_path)],
                     ROOT, env):
            detail = stage_diagnostic(board / "project.json", "errors", work)
            raise Rejected("Design conversion failed (unsupported or incomplete design)" + (": " + detail if detail else ""))
        if run_stage([sys.executable, str(ROOT / "scripts/fabricate.py"), str(out), str(out / "input-projects")],
                     work, env):
            detail = "Independent manufacturing checks failed"
            blockers = stage_diagnostic(board / "validation.json", "blockers", work)
            if blockers:
                detail += ": " + blockers
            raise Rejected(detail)
        return bundle(board, source)


def hosted_password(origin, port, password):
    """Fail closed for external origins; TLS terminates at a trusted proxy."""
    if password is not None and (len(password) < 32 or len(password) > 256
                                 or any(not 33 <= ord(c) <= 126 for c in password)):
        raise ValueError("PCBWB_HOSTED_PASSWORD must be 32-256 printable non-space ASCII characters")
    if origin != f"http://127.0.0.1:{port}":
        if urlsplit(origin).scheme != "https" or password is None:
            raise ValueError("External origin requires HTTPS and PCBWB_HOSTED_PASSWORD")
    return password


def make_handler(origin, static, runner=manufacture, password=None):
    authority = urlsplit(origin).netloc
    manufacturing_slot = threading.BoundedSemaphore(1)
    expected = None if password is None else hashlib.sha256(
        base64.b64encode(("pcbwb:" + password).encode("ascii"))).digest()

    class Handler(SimpleHTTPRequestHandler):
        timeout = 15

        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(static), **kwargs)

        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            super().end_headers()

        def authorized(self):
            if self.headers.get_all("Host") != [authority]:
                self.error_json(403, "Host mismatch")
                return False
            if expected is None:
                return True
            values = self.headers.get_all("Authorization") or []
            if len(values) == 1:
                scheme, _, token = values[0].partition(" ")
                if scheme.lower() == "basic" and hmac.compare_digest(
                        hashlib.sha256(token.encode("utf-8")).digest(), expected):
                    return True
            self.send_response(401)
            self.send_header("WWW-Authenticate", 'Basic realm="PCB Workbench"')
            self.send_header("Content-Length", "0")
            self.end_headers()
            return False

        def reply(self, status, body, kind="application/json", attachment=False, source=None):
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            if attachment:
                self.send_header("Content-Disposition", 'attachment; filename="PCBWB-DRAFT-DO-NOT-ORDER.zip"')
                self.send_header("X-PCBWB-Source-SHA256", hashlib.sha256(source).hexdigest())
                self.send_header("X-PCBWB-Bundle-SHA256", hashlib.sha256(body).hexdigest())
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def error_json(self, status, message):
            self.reply(status, json.dumps({"error": message, "orderReady": False}).encode())

        def do_GET(self):
            if not self.authorized():
                return
            if self.path == API:
                return self.reply(200, b'{"service":"pcbwb-manufacturing-v1","orderReady":false}')
            return super().do_GET()

        def do_HEAD(self):
            if not self.authorized():
                return
            if self.path == API:
                return self.reply(200, b'{"service":"pcbwb-manufacturing-v1","orderReady":false}')
            return super().do_HEAD()

        def do_POST(self):
            if not self.authorized():
                return
            if self.path != API:
                return self.error_json(404, "Unknown endpoint")
            if self.headers.get_all("Origin") != [origin]:
                return self.error_json(403, "Same-origin request required")
            if self.headers.get("Transfer-Encoding") or self.headers.get_content_type() != "application/json":
                return self.error_json(415, "JSON with Content-Length required")
            lengths = self.headers.get_all("Content-Length") or []
            if len(lengths) != 1 or not lengths[0].isascii() or not lengths[0].isdigit() or len(lengths[0]) > 8:
                return self.error_json(400, "Invalid Content-Length")
            size = int(lengths[0])
            if not 0 < size <= MAX_INPUT:
                return self.error_json(413, "Input size outside limit")
            try:
                source = self.rfile.read(size)
                if len(source) != size:
                    return self.error_json(400, "Incomplete request")
                if not manufacturing_slot.acquire(blocking=False):
                    return self.error_json(503, "Another manufacturing job is running; retry later")
                try:
                    result = runner(source)
                finally:
                    manufacturing_slot.release()
            except Rejected as exc:
                return self.error_json(422, str(exc))
            except (OSError, ValueError, KeyError, TypeError):
                return self.error_json(500, "Manufacturing unavailable or invalid engine output")
            return self.reply(200, result, "application/zip", attachment=True, source=source)

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--origin", help="Exact external HTTPS origin behind a trusted authenticated proxy")
    args = parser.parse_args()
    origin = args.origin or f"http://127.0.0.1:{args.port}"
    parsed = urlsplit(origin)
    if (parsed.scheme not in ("http", "https") or not parsed.netloc
            or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment):
        parser.error("Use an exact HTTP(S) origin without trailing slash")
    try:
        password = hosted_password(origin, args.port, os.environ.get("PCBWB_HOSTED_PASSWORD"))
    except ValueError as exc:
        parser.error(str(exc))
    if not (ROOT / "dist" / "editor.html").is_file():
        parser.error("Run bun run build first")
    with BoundedHTTPServer(("127.0.0.1", args.port), make_handler(origin, ROOT / "dist", password=password)) as server:
        print("Review-only service: " + origin + "/editor.html", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
