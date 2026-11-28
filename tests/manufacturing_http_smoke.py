"""Real HTTP integration with the independent manufacturing engines."""
import csv
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
            def submit(source, label="invalid fixture"):
                try:
                    return urlopen(Request(origin + API, source, {"Origin":origin,"Content-Type":"application/json"}), timeout=380)
                except HTTPError as error:
                    if label != "invalid fixture":
                        print("HTTP manufacturing failed:", label, error.code,
                              error.read(4096).decode("utf-8", errors="replace"), flush=True)
                    raise
            cases = [(path, (ROOT / path).read_bytes()) for path in
                     ["projects/native-resistors-manual/native.json","projects/native-rc-manual/native.json"]]
            # Exercise the HTTP-specific automatic routing flags and zone fill.
            complex_project = json.loads((ROOT / "tests/fixtures/obstacle-two-layer-multi.json").read_bytes())
            def zone(id, net, layer, y_min, y_max):
                return {"id":id,"net":net,"layer":layer,"clearance":.25,
                        "bounds":{"xMin":-3.8,"xMax":3.8,"yMin":y_min,"yMax":y_max}}
            complex_project["zones"] = [
                zone("Z1","SUPPLY","top",-14.5,-1),
                zone("Z2","SUPPLY_B","top",1,14.5),
                zone("Z3","RETURN","bottom",-14.5,-1),
                zone("Z4","RETURN_B","bottom",1,14.5)]
            cases.append(("two-layer-multi-with-zones", json.dumps(complex_project).encode()))
            for path, source in cases:
                with submit(source, path) as response, zipfile.ZipFile(io.BytesIO(response.read())) as archive:
                    assert response.headers["Content-Type"] == "application/zip"
                    assert set(archive.namelist()) == set(FILES) | {"source-project.json","source-sha256.txt"}
                    assert archive.read("source-project.json") == source
                    assert archive.read("source-sha256.txt").decode().strip() == hashlib.sha256(source).hexdigest()
                    validation = json.loads(archive.read("validation.json"))
                    assert validation["orderReady"] is False
                    expected_refs = {part["ref"] for part in json.loads(source)["components"]}
                    for name in ("BOM.csv","CPL.csv"):
                        rows = list(csv.DictReader(io.StringIO(archive.read(name).decode("utf-8"))))
                        assert len(rows) == len(expected_refs)
                        assert {row["Designator"] for row in rows} == expected_refs
                    with zipfile.ZipFile(io.BytesIO(archive.read("Gerber.zip"))) as gerber:
                        names = gerber.namelist()
                        assert any(n.lower().endswith((".gbr",".gtl")) and
                                   b"TF.FileFunction,Copper,L1,Top" in gerber.read(n) for n in names), names
                        assert any(n.lower().endswith(".gko") or "edge_cuts" in n.lower() or
                                   "edge.cuts" in n.lower() for n in names), names
                        assert gerber.testzip() is None
                        if path == "two-layer-multi-with-zones":
                            assert validation["drillParity"]["platedViaHoles"] == 4
                            assert len(validation["zoneParity"]) == 4
                            assert all(z["polygonAreaMm2"] > 1 for z in validation["zoneParity"])
                            assert validation["drillParity"]["file"] in names
                            assert any(n.lower().endswith((".gbr",".gbl")) and
                                       b"TF.FileFunction,Copper,L2,Bot" in gerber.read(n) for n in names), names
                        print("Gerber archive members:", names, flush=True)
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
