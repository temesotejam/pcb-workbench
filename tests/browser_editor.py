"""Real Chromium interaction smoke test against the generated static site.
Run after bun run build; pip install playwright==1.51.0; playwright install chromium.
No external service, order API or user storage is used.
"""
import functools
import http.server
import json
from pathlib import Path
import tempfile
import threading
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
KEY = "pcb-workbench.native-project.v1"


def run():
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", 0),
        functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT / "dist"),
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            context = browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("dialog", lambda dialog: dialog.accept())
            page.goto(f"http://127.0.0.1:{server.server_port}/editor.html")
            expect(page.locator("#controls")).to_be_visible()

            def saved():
                return page.evaluate("(key) => JSON.parse(localStorage.getItem(key))", KEY)

            def place(ref, view, x):
                field = page.get_by_label(f"{ref} {view} x", exact=True)
                field.fill(str(x))
                field.locator("..").get_by_role("button", name="適用").click()

            page.locator("#part").select_option("C17414")
            for ref, x in (("R1", -6), ("R2", 6)):
                page.locator("#add-component button").click()
                for view in ("schematic", "pcb"):
                    place(ref, view, x)
            assert len(saved()["components"]) == 2
            sch = page.locator("#schematic-view")
            sch.locator('[data-ref="R1"] [data-pin="2"]').click()
            sch.locator('[data-ref="R2"] [data-pin="1"]').click()
            assert saved()["nets"][0]["pins"] == [
                {"ref": "R1", "pin": "2"}, {"ref": "R2", "pin": "1"}
            ]
            pcb = page.locator("#pcb-view")
            ratlines = pcb.locator("[data-ratline]")
            expect(ratlines).to_have_count(1)
            page.locator("#route-mode").check()
            start = pcb.locator('[data-ref="R1"] [data-pad="2"]')
            end = pcb.locator('[data-ref="R2"] [data-pad="1"]')
            overlay = pcb.locator("[data-route-draft]")

            def board_click(x, y, shift=False):
                pcb.scroll_into_view_if_needed()
                pt = pcb.evaluate(
                    "(svg, xy) => { const p = new DOMPoint(...xy).matrixTransform(svg.getScreenCTM()); return [p.x,p.y]; }",
                    [x, -y],
                )
                if shift:
                    page.keyboard.down("Shift")
                try:
                    page.mouse.click(*pt)
                finally:
                    if shift:
                        page.keyboard.up("Shift")

            before = saved()
            start.click()
            expect(overlay).to_have_count(1)
            board_click(-2, 2, True)
            expect(page.locator("#status")).to_contain_text("B.Cu")
            end.click()  # cannot finish on the wrong copper layer
            assert saved() == before
            expect(overlay).to_have_count(1)
            page.keyboard.press("Backspace")
            expect(page.locator("#status")).to_contain_text("F.Cu")
            page.keyboard.press("Escape")
            expect(overlay).to_have_count(0)
            assert saved() == before

            start.click()
            board_click(-2, 2, True)
            page.locator("#route-via-next").check()
            board_click(2, 2)
            expect(page.locator("#route-via-next")).not_to_be_checked()
            expect(page.locator("#status")).to_contain_text("F.Cu")
            pcb.locator('[data-ref="R2"] [data-pad="2"]').click()  # wrong net
            assert saved() == before
            end.click()
            expect(overlay).to_have_count(0)
            expect(ratlines).to_have_count(0)
            project = saved()
            assert len(project["routes"]) == 1
            expect(page.locator("#copper-diagnostics")).to_contain_text("仮配線同士の検査: 0 件")
            assert project["routes"][0]["waypoints"] == [
                {"x": -2, "y": 2, "via": {"diameter": .8, "drill": .4}},
                {"x": 2, "y": 2, "via": {"diameter": .8, "drill": .4}},
            ]
            page.reload()
            expect(page.locator("#controls")).to_be_visible()
            expect(ratlines).to_have_count(0)
            assert saved() == project

            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "project.json"
                with page.expect_download() as download:
                    page.locator("#export").click()
                download.value.save_as(path)
                assert json.loads(path.read_text()) == project
                page.locator("#routes").get_by_role("button", name="削除").click()
                expect(ratlines).to_have_count(1)
                assert saved()["routes"] == []
                page.locator("#import").set_input_files(path)
                expect(ratlines).to_have_count(0)
                assert saved() == project
            # A deliberately crossing pair of top tracks, loaded only into this
            # temporary browser context, must be reported without changing it.
            crossed = json.loads(json.dumps(project))
            crossed["nets"] = [
                {"name":"A","pins":[{"ref":"R1","pin":"1"},{"ref":"R2","pin":"2"}]},
                {"name":"B","pins":[{"ref":"R1","pin":"2"},{"ref":"R2","pin":"1"}]},
            ]
            crossed["routes"] = [
                {"id":"T1","net":"A","layer":"top","width":.25,
                 "from":{"ref":"R1","pin":"1"},"to":{"ref":"R2","pin":"2"},
                 "waypoints":[{"x":0,"y":2},{"x":0,"y":-2}]},
                {"id":"T2","net":"B","layer":"top","width":.25,
                 "from":{"ref":"R1","pin":"2"},"to":{"ref":"R2","pin":"1"},"waypoints":[]},
            ]
            page.evaluate("([key, p]) => localStorage.setItem(key, JSON.stringify(p))", [KEY, crossed])
            page.reload()
            expect(page.locator("#controls")).to_be_visible()
            expect(page.locator("#copper-diagnostics")).to_contain_text("銅箔接触・重なり")
            assert saved() == crossed
            page.locator("#routes").get_by_role("button", name="削除").first.click()
            expect(page.locator("#copper-diagnostics")).to_contain_text("仮配線同士の検査: 0 件")
            # An unfilled zone must be visible without covering pads or
            # satisfying ratlines. Persist edits and reject a dangling net.
            ratline_count = ratlines.count()
            page.locator("#zone-net").select_option("A")
            page.locator("#zone-layer").select_option("bottom")
            for key, value in (("xMin",-4),("yMin",-3),("xMax",4),("yMax",3)):
                page.locator("#zone-"+key).fill(str(value))
            page.locator("#zone-submit").click()
            zone = pcb.locator('[data-zone="Z1"]')
            expect(zone).to_have_count(1)
            expect(zone).to_have_attribute("data-zone-layer","bottom")
            expect(zone).to_have_attribute("fill","none")
            expect(ratlines).to_have_count(ratline_count)
            expect(page.locator("#copper-diagnostics")).to_contain_text("未充填")
            page.locator("#zones").get_by_role("button",name="編集").click()
            page.locator("#zone-layer").select_option("top")
            page.locator("#zone-submit").click()
            expect(zone).to_have_attribute("data-zone-layer","top")
            with_zone = saved()
            page.locator("#nets tr").filter(has_text="A").get_by_role("button",name="削除").click()
            assert saved() == with_zone
            page.reload()
            expect(zone).to_have_attribute("data-zone-layer","top")
            assert saved() == with_zone
            page.locator("#zones").get_by_role("button",name="削除").click()
            expect(zone).to_have_count(0)
            assert saved()["zones"] == []
            assert not errors, errors
            context.close()
            browser.close()
            print("Chromium editor smoke: placement, pin connection, via routing, rejection, undo, persistence and JSON roundtrip passed")
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == "__main__":
    run()
