import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { parseBridgeEnvelope, normalizeWindows, bridgeHealthMatches, validateNativePatchTarget } from "./bridge.mjs"

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
