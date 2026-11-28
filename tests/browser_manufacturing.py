"""Live Chromium download through the actual independent manufacturing service."""
import hashlib
import json
import tempfile
import threading
import zipfile
from http.server import HTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from scripts.manufacturing_server import API, FILES, ROOT, make_handler

KEY = "pcb-workbench.native-project.v1"


def run():
    with HTTPServer(("127.0.0.1", 0), make_handler("http://unused", ROOT / "dist")) as server:
        origin = "http://127.0.0.1:" + str(server.server_port)
        server.RequestHandlerClass = make_handler(origin, ROOT / "dist")
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with sync_playwright() as p, tempfile.TemporaryDirectory() as directory:
                browser = p.chromium.launch()
                context = browser.new_context(accept_downloads=True)
                page = context.new_page()
                errors, downloads = [], []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.on("download", lambda download: downloads.append(download))
                page.on("dialog", lambda dialog: dialog.accept())
                page.goto(origin + "/editor.html")
                expect(page.locator("#controls")).to_be_visible()
                button = page.locator("#manufacture")
                status = page.locator("#manufacture-status")
                simple = json.loads((ROOT / "projects/native-resistors-manual/native.json").read_text())
                complex_project = json.loads((ROOT / "tests/fixtures/obstacle-two-layer-multi.json").read_text())
                complex_project["zones"] = [
                    {"id":f"Z{i}","net":net,"layer":layer,"clearance":.25,
                     "bounds":{"xMin":-3.8,"xMax":3.8,"yMin":lo,"yMax":hi}}
                    for i, net, layer, lo, hi in [
                        (1,"SUPPLY","top",-14.5,-1),(2,"SUPPLY_B","top",1,14.5),
                        (3,"RETURN","bottom",-14.5,-1),(4,"RETURN_B","bottom",1,14.5)]
                ]
                def load(project):
                    path = Path(directory) / "input.json"
                    path.write_text(json.dumps(project), encoding="utf-8")
                    page.locator("#import").set_input_files(path)
                    expect(page.locator("#project-name")).to_have_value(project["name"])
                    return page.evaluate("(key)=>JSON.stringify(JSON.parse(localStorage.getItem(key)))", KEY).encode("utf-8")

                for i, project in enumerate((simple, complex_project)):
                    source = load(project)
                    with page.expect_download(timeout=390000) as event:
                        button.click()
                        if i == 1:
                            # A concurrent edit must not change which snapshot is delivered.
                            expect(status).to_contain_text("独立検証中")
                            page.locator("#project-name").fill("Edited during manufacturing")
                            page.locator("#board-form button").first.click()
                    result = event.value
                    assert result.suggested_filename == "PCBWB-DRAFT-DO-NOT-ORDER.zip"
                    target = Path(directory) / f"result-{i}.zip"
                    result.save_as(target)
                    with zipfile.ZipFile(target) as archive:
                        assert archive.testzip() is None
                        assert set(archive.namelist()) == set(FILES) | {"source-project.json","source-sha256.txt"}
                        assert archive.read("source-project.json") == source
                        assert archive.read("source-sha256.txt").decode().strip() == hashlib.sha256(source).hexdigest()
                        validation = json.loads(archive.read("validation.json"))
                        assert validation["orderReady"] is False
                        if i == 1:
                            assert validation["drillParity"]["platedViaHoles"] == 4
                            assert len(validation["zoneParity"]) == 4
                    expect(status).to_contain_text("レビュー用ZIP取得")
                    if i == 1:
                        expect(status).to_contain_text("現在の編集内容とは異なります")
                    expect(button).to_be_enabled()
                    print("Live Chromium manufacturing download verified:", project["name"], flush=True)

                # Empty model is valid as a draft, not as a manufactured board.
                page.locator("#new").click()
                button.click()
                expect(status).to_contain_text("取得不可", timeout=390000)
                expect(button).to_be_enabled()
                assert len(downloads) == 2

                # Isolate a corrupted response; capability GET still uses the real server.
                source = load(simple)
                def corrupt(route):
                    if route.request.method != "POST":
                        return route.continue_()
                    route.fulfill(status=200, content_type="application/zip",
                                  headers={"X-PCBWB-Source-SHA256":hashlib.sha256(source).hexdigest(),
                                           "X-PCBWB-Bundle-SHA256":"0"*64},
                                  body=b"PK\x03\x04bad")
                page.route(origin + API, corrupt)
                button.click()
                expect(status).to_contain_text("製造ZIPの内容が一致しません")
                expect(button).to_be_enabled()
                assert len(downloads) == 2
                assert not errors, errors
                context.close()
                browser.close()
                print("Chromium rejected invalid design and corrupted delivery", flush=True)
        finally:
            server.shutdown()
            thread.join()


if __name__ == "__main__":
    run()
