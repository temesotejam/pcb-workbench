import io
import json
import hashlib
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from http.server import HTTPServer
import zipfile
from scripts.manufacturing_server import API, FILES, Rejected, audit_gerber_archive, bundle, make_handler


def gerber_zip(entries):
    result = io.BytesIO()
    with zipfile.ZipFile(result, 'w') as archive:
        for name, content in entries:
            archive.writestr(name, content)
    result.seek(0)
    return result


class ManufacturingServerTests(unittest.TestCase):
    def test_accepts_protel_and_standard(self):
        for top, edge in [('board.gtl','board.gko'), ('board-F_Cu.gbr','board-Edge_Cuts.gbr')]:
            with self.subTest(top=top):
                audit_gerber_archive(gerber_zip([(top,b'%TF.FileFunction,Copper,L1,Top*%'),(edge,b'outline')]))

    def test_rejects_missing_wrong_or_unsafe(self):
        top = ('board.gtl',b'%TF.FileFunction,Copper,L1,Top*%')
        edge = ('board.gko',b'outline')
        for entries in [[top], [edge], [('board.gtl',b'not copper'),edge], [top,edge,('../other',b'x')], [top,edge,('empty',b'')]]:
            with self.subTest(entries=entries), self.assertRaises(Rejected):
                audit_gerber_archive(gerber_zip(entries))
        with self.assertRaises(Rejected):
            audit_gerber_archive(io.BytesIO(b'not zip'))

    def test_bundle_exact_source_and_allowlist(self):
        source = b'{"schemaVersion":1}'
        with tempfile.TemporaryDirectory() as directory:
            board = Path(directory)
            draft = board / "draft"
            draft.mkdir()
            (board / "project.json").write_text('{"status":"draft","orderReady":false}')
            (board / "validation.json").write_text('{"orderReady":false}')
            for name in FILES:
                (draft / name).write_text(name)
            (draft / "Gerber.zip").write_bytes(gerber_zip([("board.gtl",b"%TF.FileFunction,Copper,L1,Top*%"),("board.gko",b"outline")]).getvalue())
            (draft / "unexpected").write_text("not exported")
            with zipfile.ZipFile(io.BytesIO(bundle(board, source))) as archive:
                self.assertEqual(set(archive.namelist()), set(FILES) | {"source-project.json","source-sha256.txt"})
                self.assertEqual(archive.read("source-project.json"), source)
                self.assertEqual(archive.read("source-sha256.txt").decode().strip(), hashlib.sha256(source).hexdigest())
            valid = (draft / "Gerber.zip").read_bytes()
            (draft / "Gerber.zip").write_bytes(b"invalid archive")
            with self.assertRaises(Rejected):
                bundle(board, source)
            (draft / "Gerber.zip").write_bytes(valid)
            (draft / "CPL.csv").unlink()
            with self.assertRaises(Rejected):
                bundle(board, source)
            (board / "project.json").write_text('{"status":"blocked","orderReady":false}')
            with self.assertRaises(Rejected):
                bundle(board, source)

    def test_http_gate_and_exact_snapshot(self):
        calls = []
        def runner(source):
            calls.append(source)
            if source == b"bad":
                raise Rejected("DRC failed")
            return b"zip"
        with tempfile.TemporaryDirectory() as directory:
            with HTTPServer(("127.0.0.1", 0), make_handler("http://unused", directory, runner)) as server:
                origin = "http://127.0.0.1:" + str(server.server_port)
                server.RequestHandlerClass = make_handler(origin, directory, runner)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    with urlopen(origin + API) as response:
                        self.assertFalse(json.load(response)["orderReady"])
                    def post(body, sender=origin, kind="application/json", host=None):
                        headers = {"Content-Type":kind}
                        if sender is not None:
                            headers["Origin"] = sender
                        if host is not None:
                            headers["Host"] = host
                        return urlopen(Request(origin+API, body, headers))
                    for sender, kind, host, status in [
                        ("https://other.test","application/json",None,403),
                        (None,"application/json",None,403),
                        (origin,"text/plain",None,415),
                        (origin,"application/json","other.test",403),
                    ]:
                        with self.assertRaises(HTTPError) as error:
                            post(b"{}",sender,kind,host)
                        self.assertEqual(error.exception.code,status)
                    self.assertEqual(calls,[])
                    with post(b'{"name":"snapshot"}') as response:
                        self.assertEqual(response.read(),b"zip")
                        self.assertEqual(response.headers["Content-Type"],"application/zip")
                    self.assertEqual(calls,[b'{"name":"snapshot"}'])
                    with self.assertRaises(HTTPError) as error:
                        post(b"bad")
                    self.assertEqual(error.exception.code,422)
                    self.assertFalse(json.load(error.exception)["orderReady"])
                finally:
                    server.shutdown()
                    thread.join()
