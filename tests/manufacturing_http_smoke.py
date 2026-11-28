"""Real HTTP integration with the independent manufacturing engines."""
import hashlib
import io
import json
import threading
from http.server import HTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import zipfile
from scripts.manufacturing_server import API, FILES, ROOT, make_handler

def run():
    with HTTPServer(("127.0.0.1", 0), make_handler("http://unused", ROOT / "dist")) as server:
        origin = "http://127.0.0.1:" + str(server.server_port)
        server.RequestHandlerClass = make_handler(origin, ROOT / "dist")
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            def submit(source):
                return urlopen(Request(origin + API, source, {"Origin":origin,"Content-Type":"application/json"}), timeout=380)
            for path in ["projects/native-resistors-manual/native.json","projects/native-rc-manual/native.json"]:
                source = (ROOT / path).read_bytes()
                with submit(source) as response, zipfile.ZipFile(io.BytesIO(response.read())) as archive:
                    assert response.headers["Content-Type"] == "application/zip"
                    assert set(archive.namelist()) == set(FILES) | {"source-project.json","source-sha256.txt"}
                    assert archive.read("source-project.json") == source
                    assert archive.read("source-sha256.txt").decode().strip() == hashlib.sha256(source).hexdigest()
                    assert json.loads(archive.read("validation.json"))["orderReady"] is False
                    with zipfile.ZipFile(io.BytesIO(archive.read("Gerber.zip"))) as gerber:
                        assert any(n.endswith(".gbr") for n in gerber.namelist())
                print("HTTP independent draft verified:", path, flush=True)
            try:
                submit(b'{"schemaVersion":1}')
                raise AssertionError("Invalid design accepted")
            except HTTPError as error:
                assert error.code == 422
                assert json.load(error)["orderReady"] is False
        finally:
            server.shutdown()
            thread.join()

if __name__ == "__main__":
    run()
