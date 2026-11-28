"""Single-user same-origin review-only manufacturing service; not a public API."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlsplit
import zipfile

ROOT = Path(__file__).resolve().parents[1]
API = "/api/manufacture"
MAX_INPUT = 2_000_000
MAX_RESULT = 32 * 1024 * 1024
FILES = ("Gerber.zip", "BOM.csv", "CPL.csv", "DO_NOT_ORDER.txt",
         "validation.json", "erc.json", "drc.json")


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
            raise Rejected("Design conversion failed (unsupported or incomplete design)")
        if run_stage([sys.executable, str(ROOT / "scripts/fabricate.py"), str(out), str(out / "input-projects")],
                     work, env):
            detail = "Independent manufacturing checks failed"
            report = board / "validation.json"
            if report.is_file():
                blockers = read_json(report).get("blockers", [])
                if isinstance(blockers, list):
                    detail += ": " + "; ".join(str(b) for b in blockers)[:2000]
            raise Rejected(detail)
        return bundle(board, source)


def make_handler(origin, static, runner=manufacture):
    authority = urlsplit(origin).netloc

    class Handler(SimpleHTTPRequestHandler):
        timeout = 15

        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(static), **kwargs)

        def reply(self, status, body, kind="application/json", attachment=False):
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            if attachment:
                self.send_header("Content-Disposition", 'attachment; filename="PCBWB-DRAFT-DO-NOT-ORDER.zip"')
            self.end_headers()
            self.wfile.write(body)

        def error_json(self, status, message):
            self.reply(status, json.dumps({"error": message, "orderReady": False}).encode())

        def do_GET(self):
            if self.path == API:
                if self.headers.get("Host") != authority:
                    return self.error_json(403, "Host mismatch")
                return self.reply(200, b'{"service":"pcbwb-manufacturing-v1","orderReady":false}')
            return super().do_GET()

        def do_POST(self):
            if self.path != API:
                return self.error_json(404, "Unknown endpoint")
            if self.headers.get("Host") != authority or self.headers.get("Origin") != origin:
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
                result = runner(source)
            except Rejected as exc:
                return self.error_json(422, str(exc))
            except (OSError, ValueError, KeyError, TypeError):
                return self.error_json(500, "Manufacturing unavailable or invalid engine output")
            return self.reply(200, result, "application/zip", attachment=True)

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
    if not (ROOT / "dist" / "editor.html").is_file():
        parser.error("Run bun run build first")
    with HTTPServer(("127.0.0.1", args.port), make_handler(origin, ROOT / "dist")) as server:
        print("Review-only service: " + origin + "/editor.html", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
