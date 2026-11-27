import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectToCircuitPlan,planMetadata} from "../scripts/project-adapter.js";
const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url),"utf8"));
const catalog=read("../library/catalog.json");
for(const id of ["native-resistors","native-rc"]){
  test(id+" preserves exact identities, positions and named pin assignments",()=>{
    const p=read("../projects/"+id+"/native.json"),before=JSON.stringify(p);
    const plan=projectToCircuitPlan(p,catalog);
    assert.deepEqual(plan.board,p.board);
    assert.deepEqual(plan.parts.map(x=>[x.ref,x.lcsc]),p.components.map(x=>[x.ref,x.lcsc]));
    assert.deepEqual(plan.placements.map(x=>[x.pcbX,x.pcbY,x.pcbRotation,x.schX,x.schY,x.schRotation]),p.components.map(x=>[x.pcb.x,x.pcb.y,x.pcb.rotation,x.schematic.x,x.schematic.y,x.schematic.rotation]));
    assert.deepEqual(plan.nets,p.nets.map(n=>n.name));
    for(const n of p.nets)for(const pin of n.pins)assert.ok(plan.traces.some(t=>t.from==="."+pin.ref+" > .pin"+pin.pin&&t.to==="net."+n.name));
    assert.equal(plan.traces.length,4);assert.equal(plan.orderReady,false);
    const meta=planMetadata(plan,id);assert.equal(meta.release,false);assert.equal(meta.parts.every(x=>!x.reviewed&&x.rotationOffset===null),true);
    assert.equal(JSON.stringify(p),before);
  });
}
test("invalid and incomplete models fail closed",()=>{
  const p=read("../projects/native-rc/native.json");
  p.nets[0].pins.pop();assert.throws(()=>projectToCircuitPlan(p,catalog),/Logical design incomplete/);
  p.components[0].lcsc="C999999";assert.throws(()=>projectToCircuitPlan(p,catalog),/Unsupported/);
});
