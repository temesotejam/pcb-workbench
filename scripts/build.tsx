import { Circuit } from "tscircuit"
import { CircuitJsonToKicadSchConverter, CircuitJsonToKicadPcbConverter, CircuitJsonToKicadProConverter } from "circuit-json-to-kicad"
import { convertCircuitJsonToSchematicSvg, convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { cp, mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises"
import { resolve } from "node:path"
import { resolveParts, assertSourceParity } from "../library/parts"
import { jlcpcbFootprintResolver } from "../library/footprints"

type SExprBlock = { start:number; end:number; text:string }
function sexprBlocks(source:string, token:string):SExprBlock[] {
  const blocks:SExprBlock[]=[]
  let cursor=0
  while(true){
    const start=source.indexOf(token,cursor)
    if(start<0)break
    let depth=0,inString=false,escaped=false,end=-1
    for(let i=start;i<source.length;i++){
      const c=source[i]
      if(inString){
        if(escaped)escaped=false
        else if(c==="\\")escaped=true
        else if(c==='"')inString=false
        continue
      }
      if(c==='"'){inString=true;continue}
      if(c==="(")depth++
      else if(c===")"){
        depth--
        if(depth===0){end=i+1;break}
      }
    }
    if(end<0)throw new Error("Unbalanced KiCad S-expression starting at "+start)
    blocks.push({start,end,text:source.slice(start,end)})
    cursor=end
  }
  return blocks
}
function replaceSexprBlocks(source:string,token:string,transform:(block:string)=>string):string{
  const blocks=sexprBlocks(source,token)
  for(const b of blocks.reverse())source=source.slice(0,b.start)+transform(b.text)+source.slice(b.end)
  return source
}
function quoteKicad(s:string){return s.replace(/\\/g,"\\\\").replace(/"/g,'\\"')}
function prepareKicadParity(schematicFiles:{filename:string,content:string}[],pcbText:string){
  const footprintByRef=new Map<string,string>(),descriptionByRef=new Map<string,string>(),libraryFiles=new Map<string,string>()
  for(const block of sexprBlocks(pcbText,"(footprint")){
    const fullName=block.text.match(/^\(footprint\s+"([^"]+)"/)?.[1]
    const ref=block.text.match(/\(property "Reference" "([^"]+)"/)?.[1]
    if(!fullName||!ref)continue
    footprintByRef.set(ref,fullName)
    const split=fullName.indexOf(":")
    if(split<1)throw new Error("KiCad footprint ID must include a library: "+fullName)
    const lib=fullName.slice(0,split),item=fullName.slice(split+1)
    let snapshot=block.text.replace(/^\(footprint\s+"[^"]+"/,'(footprint "'+quoteKicad(item)+'" (version 20250114) (generator "pcbnew")')
    snapshot=snapshot.replace(/(\n\s*)\(at [^\n]*\)/,"$1(at 0 0 0)")
    snapshot=snapshot.replace(/\(uuid\s+[^)]+\)/g,"")
    snapshot=snapshot.replace(/\(net\s+\d+\s+"[^"]+"\)/g,"")
    snapshot=snapshot.replace(/\(property "Reference" "[^"]*"/,'(property "Reference" "REF**"')
    snapshot=snapshot.replace(/\(property "Value" "[^"]*"/,'(property "Value" "'+quoteKicad(item)+'"')
    snapshot=snapshot.replace(/\(property "Supplier Part Number" "[^"]*"/g,'(property "Supplier Part Number" ""')
    const key=lib+"/"+item,prior=libraryFiles.get(key)
    if(prior&&prior!==snapshot)throw new Error("Same KiCad footprint ID has different geometry: "+key)
    libraryFiles.set(key,snapshot)
  }
  for(const file of schematicFiles){
    for(const block of sexprBlocks(file.content,"(symbol")){
      const ref=block.text.match(/\(property "Reference" "([^"]+)"/)?.[1]
      if(!ref||!footprintByRef.has(ref))continue
      const desc=block.text.match(/\(property "Description" "([^"]*)"/)?.[1]
      if(desc)descriptionByRef.set(ref,desc)
    }
  }
  const patchedSchematics=schematicFiles.map(file=>({
    ...file,
    content:replaceSexprBlocks(file.content,"(symbol",block=>{
      const ref=block.match(/\(property "Reference" "([^"]+)"/)?.[1]
      const footprint=ref?footprintByRef.get(ref):undefined
      if(!footprint)return block
      return block.replace(/\(property "Footprint" ""/,'(property "Footprint" "'+quoteKicad(footprint)+'"')
    })
  }))
  const patchedPcb=replaceSexprBlocks(pcbText,"(footprint",block=>{
    const ref=block.match(/\(property "Reference" "([^"]+)"/)?.[1]
    const description=ref?descriptionByRef.get(ref):undefined
    if(!description)return block
    return block.replace(/\(property "Description" ""/,'(property "Description" "'+quoteKicad(description)+'"')
  })
  const symbolLibraries=new Set<string>()
  for(const file of patchedSchematics){
    for(const match of file.content.matchAll(/\(lib_id "([^"]+)"/g)){
      const full=match[1],split=full.indexOf(":")
      if(split>0)symbolLibraries.add(full.slice(0,split))
    }
  }
  const symbolPrefix='$'+'{KICAD_SYMBOL_DIR}/'
  const projectPrefix='$'+'{KIPRJMOD}/'
  const symTable='(sym_lib_table\n'+[...symbolLibraries].sort().map(lib=>'  (lib (name "'+quoteKicad(lib)+'") (type "KiCad") (uri "'+symbolPrefix+quoteKicad(lib)+'.kicad_sym") (options "") (descr ""))').join("\n")+'\n)\n'
  const fpLibraries=[...new Set([...libraryFiles.keys()].map(k=>k.split("/")[0]))]
  const fpTable='(fp_lib_table\n'+fpLibraries.sort().map(lib=>'  (lib (name "'+quoteKicad(lib)+'") (type "KiCad") (uri "'+projectPrefix+quoteKicad(lib)+'.pretty") (options "") (descr "Resolved component geometry"))').join("\n")+'\n)\n'
  return {schematicFiles:patchedSchematics,pcbText:patchedPcb,libraryFiles,symTable,fpTable}
}

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
    const namedNets=json.filter((x:any)=>x.type==="source_net").map((x:any)=>x.name)
    for(const expected of ["R1_R2_PIN1","R1_R2_PIN2"])if(!namedNets.includes(expected))throw new Error("Named net missing from Circuit JSON: "+expected)
    await writeFile(resolve(path,"circuit.json"),JSON.stringify(json,null,2))
    result.files.push("circuit.json")
    assertSourceParity(json,result.parts)
    await writeFile(resolve(path,"schematic.svg"),convertCircuitJsonToSchematicSvg(json))
    await writeFile(resolve(path,"pcb.svg"),convertCircuitJsonToPcbSvg(json))
    result.files.push("schematic.svg","pcb.svg")
    const sch = new CircuitJsonToKicadSchConverter(json)
    sch.runUntilFinished()
    const schFiles=sch.getOutputFiles({schematicFilename:"board.kicad_sch"})
      .filter((f:any)=>/^[a-zA-Z0-9_. -]+\.kicad_sch$/.test(f.filename))
      .map((f:any)=>({filename:f.filename,content:f.content}))
    const pcb = new CircuitJsonToKicadPcbConverter(json)
    pcb.runUntilFinished()
    const pcbText=pcb.getOutputString()
    const prepared=prepareKicadParity(schFiles,pcbText)
    for(const f of prepared.schematicFiles){
      await writeFile(resolve(path,f.filename),f.content)
      result.files.push(f.filename)
    }
    await writeFile(resolve(path,"board.kicad_pcb"),prepared.pcbText)
    const pro = new CircuitJsonToKicadProConverter(json,{projectName:"board",schematicFilename:"board.kicad_sch",pcbFilename:"board.kicad_pcb"})
    pro.runUntilFinished()
    await writeFile(resolve(path,"board.kicad_pro"),pro.getOutputString())
    const prettyByLib=new Map<string,string[]>()
    for(const [key,content] of prepared.libraryFiles){
      const [lib,item]=key.split("/")
      const libDir=resolve(path,lib+".pretty")
      await mkdir(libDir,{recursive:true})
      await writeFile(resolve(libDir,item+".kicad_mod"),content)
      prettyByLib.set(lib,[...(prettyByLib.get(lib)??[]),item+".kicad_mod"])
    }
    await writeFile(resolve(path,"sym-lib-table"),prepared.symTable)
    await writeFile(resolve(path,"fp-lib-table"),prepared.fpTable)
    result.files.push("board.kicad_pcb","board.kicad_pro","sym-lib-table","fp-lib-table",...([...prettyByLib].flatMap(([lib,files])=>files.map(f=>lib+".pretty/"+f))))
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
