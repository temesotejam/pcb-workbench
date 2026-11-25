import test from "node:test"
import assert from "node:assert/strict"
import { parseEnvelope, parseVersion, versionAtLeast, parseCsv, validateProjectFiles, checkBomCpl, hashProjectDir, writeProjectFiles } from "./engine.mjs"
import { mkdtemp, writeFile, mkdir, rm, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { zipSync } from "fflate"

const enc=s=>new TextEncoder().encode(s)

test("CLI envelope accepts wrapped JSON and checks errors",()=>{
 assert.deepEqual(parseEnvelope('log\n{"ok":true,"value":{"x":1},"logs":[]}'),{x:1})
 assert.throws(()=>parseEnvelope('{"ok":false,"error":{"message":"no"}}'),/no/)
})
test("version gate uses numeric segments",()=>{
 assert.deepEqual(parseVersion("EasyEDA Pro 4.1.105.abcdef"),[4,1,105]);assert.deepEqual(parseVersion("EasyEDA Pro 4.1.x.abcdef"),[4,1,null]);assert.equal(versionAtLeast([4,1,null],[4,1,60],true),true);assert.equal(versionAtLeast([4,1,null],[4,1,60]),false)
 assert.equal(versionAtLeast([4,1,105]),true)
 assert.equal(versionAtLeast([4,1,60]),true);assert.equal(versionAtLeast([4,1,59]),false)
 assert.equal(versionAtLeast([4,2,0]),true)
})
test("CSV parser handles comma CSV, quoted commas, escaped quotes, CRLF and tab-separated EasyEDA BOM",()=>{
 assert.deepEqual(parseCsv('A,B\r\n"x,y","z""z"\r\n'),[{A:"x,y",B:'z"z'}])
 assert.deepEqual(parseCsv('No.\tQuantity\tComment\tDesignator\tFootprint\tSupplier Part\tSupplier\r\n1\t2\t10k\tR1,R2\tR0603\tC17414\tLCSC\r\n'),[{ "No.":"1",Quantity:"2",Comment:"10k",Designator:"R1,R2",Footprint:"R0603","Supplier Part":"C17414",Supplier:"LCSC"}])
})
test("project package must have one EPRJ3 and native docs",()=>{
 const p={"Demo.eprj3":enc(JSON.stringify({profile:{}})),"pcb/Board.epcb2":enc("x"),"sch/Main/Page.esch2":enc("x")}
 assert.equal(validateProjectFiles(p).projectName,"Demo")
 assert.throws(()=>validateProjectFiles({...p,"../escape.txt":enc("x")}),/Unsafe/)
 assert.throws(()=>validateProjectFiles({"pcb/Board.epcb2":enc("x")}),/eprj3/i)
})
test("BOM and CPL reference parity is enforced",()=>{
 const bom='Quantity,Designator,Comment,Footprint,Supplier,Supplier Part\r\n1,R1,10k,0603,LCSC,C17414\r\n'
 const cpl='Designator,Mid X,Mid Y,Rotation,Layer\r\nR1,1,2,90,Top\r\n'
 assert.equal(checkBomCpl(bom,cpl).blockers.length,0)
 assert.ok(checkBomCpl(bom,cpl.replace('R1,1','R2,1')).blockers.length)
})
test("JLCPCB CSV validates millimeter coordinates and flags THT and known underside connectors",()=>{
 const bom='Quantity,Designator,Comment,Footprint,LCSC Part #\r\n1,CN7,Header,2x19,C42372543\r\n'
 const cpl='Designator,Mid X,Mid Y,Rotation,Layer,SMD\r\nCN7,1.25mm,-2.5mm,90,T,No\r\n'
 const r=checkBomCpl(bom,cpl,{expectedSideByRef:{CN7:"Bottom"}})
 assert.ok(r.blockers.some(x=>x.includes("CN7")&&x.includes("Bottom")))
 assert.ok(r.warnings.some(x=>x.includes("THT part CN7")))
 const bottom=checkBomCpl(bom,cpl.replace(",T,No",",B,No"),{expectedSideByRef:{CN7:"Bottom"}})
 assert.equal(bottom.blockers.length,0)
 assert.equal(r.cplNormalized[0]["Mid X"],"1.2500")
 assert.equal(r.cplNormalized[0].Layer,"Top")
})
test("hashes only native project files and detects revision changes",async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),"pwb-hash-"))
 try{
  await mkdir(path.join(dir,"pcb"),{recursive:true})
  await writeFile(path.join(dir,"Demo.eprj3"),"{}")
  await writeFile(path.join(dir,"pcb","Board.epcb2"),"one")
  await writeFile(path.join(dir,"preview.png"),"not-native")
  const a=await hashProjectDir(dir)
  assert.equal(Object.keys(a.hashes).length,2)
  await writeFile(path.join(dir,"pcb","Board.epcb2"),"two")
  const b=await hashProjectDir(dir)
  assert.notEqual(a.sourceRevision,b.sourceRevision)
 }finally{await rm(dir,{recursive:true,force:true})}
})
test("live project update writes only changed native files and enforces file-set parity",async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),"pwb-update-"))
 try{
  const projectDir=path.join(dir,"Demo")
  await mkdir(path.join(projectDir,"pcb"),{recursive:true})
  const initial={"Demo.eprj3":enc(JSON.stringify({profile:{}})),"pcb/Board.epcb2":enc("old"),"sch/Page.esch2":enc("page")}
  for(const [name,data] of Object.entries(initial)){
   const target=path.join(projectDir,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,data)
  }
  const active={projectName:"Demo",projectPath:path.join(projectDir,"Demo.eprj3"),sourcePaths:Object.keys(initial)}
  const next={...initial,"pcb/Board.epcb2":enc("new")}
  const result=await writeProjectFiles(zipSync(next),active)
  assert.deepEqual(result.updatedFiles,["pcb/Board.epcb2"])
  assert.equal((await readFile(path.join(projectDir,"pcb","Board.epcb2"))).toString(),"new")
  await assert.rejects(writeProjectFiles(zipSync({...next,"extra.evar":enc("x")}),active),/file set/)
 }finally{await rm(dir,{recursive:true,force:true})}
})
