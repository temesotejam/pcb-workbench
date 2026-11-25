import test from "node:test"
import assert from "node:assert/strict"
import { parseBridgeEnvelope, normalizeWindows, bridgeHealthMatches } from "./bridge.mjs"
test("Bridge envelope supports the installed service response",()=>{
 assert.deepEqual(parseBridgeEnvelope({success:true,result:{ok:1}}),{ok:1})
 assert.throws(()=>parseBridgeEnvelope({success:false,error:"no"}),/no/)
})
test("window list normalizes both documented response shapes",()=>{
 assert.deepEqual(normalizeWindows([{id:"w1"}]),[{id:"w1"}])
 assert.deepEqual(normalizeWindows({windows:[{windowId:"w2"}]}),[{windowId:"w2"}])
})
test("health identity is strict to EasyEDA bridge",()=>{
 assert.equal(bridgeHealthMatches({service:"easyeda-bridge",edaConnected:true}),true)
 assert.equal(bridgeHealthMatches({service:"other",edaConnected:false}),false)
})
