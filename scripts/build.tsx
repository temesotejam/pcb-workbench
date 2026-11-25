import { Circuit } from "tscircuit"
import { CircuitJsonToKicadSchConverter, CircuitJsonToKicadPcbConverter, CircuitJsonToKicadProConverter } from "circuit-json-to-kicad"
import { convertCircuitJsonToSchematicSvg, convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { cp, mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises"
import { resolve } from "node:path"
import { resolveParts, assertSourceParity } from "../library/parts"
import { jlcpcbFootprintResolver } from "../library/footprints"

const root = resolve(import.meta.dir, "..")
const out = resolve(root, "dist")
await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })
await cp(resolve(root, "site"), out, { recursive: true })
const handoff = await Bun.build({entrypoints:[resolve(root,"site/handoff-entry.js")],target:"browser",outdir:out,naming:"handoff.js",minify:true})
if(!handoff.success) throw new Error(handoff.logs.map(String).join("\n"))
await rm(resolve(out,"handoff-entry.js"))
await cp(resolve(root, "library", "catalog.json"), resolve(out,"catalog.json"))
const index = []
let failed = false
for (const id of (await readdir(resolve(root, "projects"))).sort()) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error("Invalid project slug: " + id)
  const dir = resolve(root, "projects", id)
  const meta = JSON.parse(await readFile(resolve(dir, "project.json"), "utf8"))
  if (meta.id !== id) throw new Error("Project id mismatch: " + id)
  const path = resolve(out, "projects", id)
  await mkdir(path, { recursive: true })
  const result = {id, name: meta.name, revision: meta.revision, purpose: meta.purpose, status:"blocked", parts:[] as ReturnType<typeof resolveParts>, errors: [] as string[], files: [] as string[]}
  try {
    result.parts = resolveParts(meta.parts)
    const Design = (await import(resolve(dir, "design.tsx"))).default
    const circuit = new Circuit({platform:{footprintLibraryMap:{jlcpcb:jlcpcbFootprintResolver}}})
    circuit.add(<Design />)
    await circuit.renderUntilSettled()
    const json = circuit.getCircuitJson()
    await writeFile(resolve(path,"circuit.json"),JSON.stringify(json,null,2))
    result.files.push("circuit.json")
    assertSourceParity(json,result.parts)
    await writeFile(resolve(path,"schematic.svg"),convertCircuitJsonToSchematicSvg(json))
    await writeFile(resolve(path,"pcb.svg"),convertCircuitJsonToPcbSvg(json))
    result.files.push("schematic.svg","pcb.svg")
    const sch = new CircuitJsonToKicadSchConverter(json)
    sch.runUntilFinished()
    for (const f of sch.getOutputFiles({schematicFilename:"board.kicad_sch"})) {
      if (!/^[a-zA-Z0-9_. -]+\.kicad_sch$/.test(f.filename)) throw new Error("Invalid schematic filename")
      await writeFile(resolve(path,f.filename),f.content)
      result.files.push(f.filename)
    }
    const pcb = new CircuitJsonToKicadPcbConverter(json)
    pcb.runUntilFinished()
    await writeFile(resolve(path,"board.kicad_pcb"),pcb.getOutputString())
    const pro = new CircuitJsonToKicadProConverter(json,{projectName:"board",schematicFilename:"board.kicad_sch",pcbFilename:"board.kicad_pcb"})
    pro.runUntilFinished()
    await writeFile(resolve(path,"board.kicad_pro"),pro.getOutputString())
    result.files.push("board.kicad_pcb","board.kicad_pro")
    const errors = json.filter((e:any) => typeof e.type === "string" && e.type.endsWith("_error"))
    result.errors = errors.map((e:any) => JSON.stringify(e))
    result.status = "preview"
  } catch(e) {
    failed = true
    result.errors.push(String(e))
    console.error(id,e)
  }
  await writeFile(resolve(path,"project.json"),JSON.stringify(result,null,2))
  index.push({id,name:meta.name,revision:meta.revision})
}
await writeFile(resolve(out,"projects.json"),JSON.stringify(index,null,2))
if(failed) process.exitCode = 1
