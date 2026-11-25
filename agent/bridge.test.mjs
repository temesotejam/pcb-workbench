import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import os from "node:os"
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
import { createHash } from "node:crypto"
import { zipSync } from "fflate"
import { parseBridgeEnvelope, normalizeWindows, bridgeHealthMatches, validateNativePatchTarget, applyNativePatchFiles, expectedAssemblySideProfile } from "./bridge.mjs"

test("Bridge response envelopes unwrap values and reject failures",()=>{
 assert.deepEqual(parseBridgeEnvelope({success:true,result:{ok:1}}),{ok:1})
 assert.deepEqual(parseBridgeEnvelope({ok:true,value:[1,2]}),[1,2])
 assert.throws(()=>parseBridgeEnvelope({success:false,error:{message:"bridge down"}}),/bridge down/)
})
test("Bridge window lists normalize documented and wrapped shapes",()=>{
 assert.deepEqual(normalizeWindows([{id:"a"}]),[{id:"a"}])
 assert.deepEqual(normalizeWindows({windows:[{id:"b"}]}),[{id:"b"}])
 assert.deepEqual(normalizeWindows({result:{windows:[{id:"c"}]}}),[{id:"c"}])
})
test("Bridge discovery requires a connected EasyEDA service",()=>{
 assert.equal(bridgeHealthMatches({service:"easyeda-bridge",edaConnected:true}),true)
 assert.equal(bridgeHealthMatches({service:"easyeda-bridge",edaConnected:false}),false)
 assert.equal(bridgeHealthMatches({service:"other",edaConnected:true}),false)
})
test("Native patch preflight requires exact project root, file set and SHA256 map",()=>{
 const root=path.resolve("/tmp/easyeda/projects"),dir=path.join(root,"Demo")
 const info={projectName:"Demo",entries:{"Demo.eprj3":new Uint8Array([1]),"pcb/Board.epcb2":new Uint8Array([2])}}
 const hashes={"Demo.eprj3":"a".repeat(64),"pcb/Board.epcb2":"b".repeat(64)}
 assert.deepEqual(validateNativePatchTarget(dir,[root],info,hashes),{dir,names:["Demo.eprj3","pcb/Board.epcb2"]})
 assert.throws(()=>validateNativePatchTarget(path.resolve("/tmp/other/Demo"),[root],info,hashes),/outside/)
 assert.throws(()=>validateNativePatchTarget(dir,[root],info,{"Demo.eprj3":"a".repeat(64)}),/base revision/)
 assert.throws(()=>validateNativePatchTarget(path.join(root,"Wrong"),[root],info,hashes),/project name/)
 assert.throws(()=>validateNativePatchTarget(dir,[root],info,{...hashes,"pcb/Board.epcb2":"bad"}),/SHA-256/)
})

const enc=s=>new TextEncoder().encode(s)
const sha=b=>createHash("sha256").update(b).digest("hex")
test("Native patch writes only changed files after exact SHA preflight and keeps backup",async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),"pwb-apply-"))
 const dir=path.join(root,"Demo")
 try{
  await mkdir(path.join(dir,"pcb"),{recursive:true})
  await mkdir(path.join(dir,"sch"),{recursive:true})
  const source={"Demo.eprj3":enc('{"profile":{}}'),"pcb/Board.epcb2":enc("old-board"),"sch/Page.esch2":enc("old-sch")}
  for(const [name,data] of Object.entries(source)){const p=path.join(dir,name);await mkdir(path.dirname(p),{recursive:true});await writeFile(p,data)}
  const baseHashes=Object.fromEntries(Object.entries(source).map(([name,data])=>[name,sha(data)]))
  const next={...source,"pcb/Board.epcb2":enc("new-board")}
  const result=await applyNativePatchFiles(dir,[root],zipSync(next),baseHashes)
  assert.deepEqual(result.updatedFiles,["pcb/Board.epcb2"])
  assert.equal((await readFile(path.join(dir,"pcb/Board.epcb2"))).toString(),"new-board")
  assert.equal((await readFile(path.join(result.backupDir,"pcb/Board.epcb2"))).toString(),"old-board")
  await rm(result.backupDir,{recursive:true,force:true})
 }finally{await rm(root,{recursive:true,force:true})}
})
test("Native patch refuses stale source before writing anything",async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),"pwb-stale-")),dir=path.join(root,"Demo")
 try{
  await mkdir(path.join(dir,"pcb"),{recursive:true});await mkdir(path.join(dir,"sch"),{recursive:true})
  const source={"Demo.eprj3":enc('{"profile":{}}'),"pcb/Board.epcb2":enc("current"),"sch/Page.esch2":enc("old-sch")}
  for(const [name,data] of Object.entries(source)){const p=path.join(dir,name);await mkdir(path.dirname(p),{recursive:true});await writeFile(p,data)}
  const baseHashes=Object.fromEntries(Object.entries(source).map(([name,data])=>[name,sha(data)]));baseHashes["pcb/Board.epcb2"]="0".repeat(64)
  await assert.rejects(applyNativePatchFiles(dir,[root],zipSync(source),baseHashes),/changed since import/)
  assert.equal((await readFile(path.join(dir,"pcb/Board.epcb2"))).toString(),"current")
 }finally{await rm(root,{recursive:true,force:true})}
})
test("Native patch pre-save failure leaves files unchanged",async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),"pwb-presave-")),dir=path.join(root,"Demo")
 try{
  await mkdir(path.join(dir,"pcb"),{recursive:true});await mkdir(path.join(dir,"sch"),{recursive:true})
  const source={"Demo.eprj3":enc('{"profile":{}}'),"pcb/Board.epcb2":enc("old"),"sch/Page.esch2":enc("old")}
  for(const [name,data] of Object.entries(source)){const p=path.join(dir,name);await mkdir(path.dirname(p),{recursive:true});await writeFile(p,data)}
  const hashes=Object.fromEntries(Object.entries(source).map(([name,data])=>[name,sha(data)]))
  await assert.rejects(applyNativePatchFiles(dir,[root],zipSync({...source,"pcb/Board.epcb2":enc("new")}),hashes,async()=>{throw new Error("save failed")}),/save failed/)
  assert.equal((await readFile(path.join(dir,"pcb/Board.epcb2"))).toString(),"old")
 }finally{await rm(root,{recursive:true,force:true})}
})

test("NUCLEO upper and lower projects have distinct CN7/CN10 assembly sides",()=>{
 assert.deepEqual(expectedAssemblySideProfile("NUCLEO-F401RE Rev1.5"),{CN7:"Bottom",CN10:"Bottom"})
 assert.deepEqual(expectedAssemblySideProfile("NUCLEO-F401RE Lower GPIO Proto R1"),{CN7:"Top",CN10:"Top"})
 assert.deepEqual(expectedAssemblySideProfile("Unregistered project"),{})
})
