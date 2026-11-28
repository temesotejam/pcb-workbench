import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createProject,validateProject,applyEdit,inspectProject} from "../site/project-model.js";
const catalog=JSON.parse(readFileSync(new URL("../library/catalog.json",import.meta.url),"utf8"));
const edit=(p,e)=>applyEdit(p,e,catalog);
function rc(){let p=createProject("RC");for(const lcsc of ["C17414","C14663"])p=edit(p,{type:"add-component",lcsc});for(const name of ["SIGNAL","GND"])p=edit(p,{type:"add-net",name});return p}
test("blank project and immutable part creation with exact catalog identity",()=>{const p=createProject();const q=edit(p,{type:"add-component",lcsc:"C17414"});assert.equal(p.components.length,0);assert.equal(q.components[0].ref,"R1");assert.equal(q.components[0].lcsc,"C17414");assert.throws(()=>edit(p,{type:"add-component",lcsc:"C999999"}))});
test("connect, reassign, disconnect and remove component without dangling pins",()=>{let p=rc();p=edit(p,{type:"assign-pin",ref:"R1",pin:"1",name:"SIGNAL"});p=edit(p,{type:"assign-pin",ref:"C1",pin:"1",name:"SIGNAL"});p=edit(p,{type:"assign-pin",ref:"R1",pin:"1",name:"GND"});assert.deepEqual(p.nets[0].pins,[{ref:"C1",pin:"1"}]);p=edit(p,{type:"assign-pin",ref:"R1",pin:"1",name:null});assert.equal(p.nets[1].pins.length,0);p=edit(p,{type:"remove-component",ref:"C1"});assert.equal(p.nets[0].pins.length,0);p=edit(p,{type:"remove-net",name:"GND"});assert.equal(p.nets.length,1)});
test("invalid imported references and duplicate memberships are rejected",()=>{const p=rc();p.nets[0].pins=[{ref:"R1",pin:"1"}];p.nets[1].pins=[{ref:"R1",pin:"1"}];assert.throws(()=>validateProject(p,catalog));p.nets[1].pins=[{ref:"R9",pin:"1"}];assert.throws(()=>validateProject(p,catalog));assert.throws(()=>edit(rc(),{type:"add-net",name:"GND"}));assert.throws(()=>edit(rc(),{type:"assign-pin",ref:"R1",pin:"3",name:"GND"}))});
test("independent schematic/PCB placement, board bounds, JSON roundtrip and blocked release",()=>{let p=rc();p=edit(p,{type:"place",ref:"R1",view:"pcb",x:25,y:0,rotation:90});assert.equal(p.components[0].schematic.x,0);assert.ok(inspectProject(p,catalog).issues.includes("Component center outside board: R1"));assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p)),catalog),p);assert.equal(inspectProject(p,catalog).orderReady,false);assert.throws(()=>edit(p,{type:"board",width:-1,height:5}));assert.throws(()=>edit(p,{type:"place",ref:"R1",view:"pcb",x:Infinity,y:0,rotation:0}))});
test("second generic two-resistor project connects every pin",()=>{let p=createProject("Resistor pair");for(let i=0;i<2;i++)p=edit(p,{type:"add-component",lcsc:"C17414"});for(const [name,pin] of [["A","1"],["B","2"]]){p=edit(p,{type:"add-net",name});for(const ref of ["R1","R2"])p=edit(p,{type:"assign-pin",ref,pin,name})}assert.deepEqual(inspectProject(p,catalog).issues,[]);assert.equal(inspectProject(p,catalog).orderReady,false)});

const zoneEdit={type:"add-zone",net:"GND",layer:"bottom",clearance:.2,bounds:{xMin:-5,yMin:-4,xMax:5,yMax:4}};
test("draft zone create/update/remove is immutable and roundtrips",()=>{
  const p=rc(),q=edit(p,zoneEdit);
  assert.equal(p.zones,undefined);assert.deepEqual(q.zones,[{id:"Z1",net:"GND",layer:"bottom",clearance:.2,bounds:zoneEdit.bounds}]);
  const t=edit(q,{...zoneEdit,type:"update-zone",id:"Z1",net:"SIGNAL",layer:"top",clearance:.3});
  assert.equal(q.zones[0].layer,"bottom");assert.equal(t.zones[0].net,"SIGNAL");assert.equal(t.zones[0].id,"Z1");
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(t)),catalog),t);
  assert.ok(inspectProject(t,catalog).issues.some(s=>s.includes("unfilled drafts")));
  assert.deepEqual(edit(t,{type:"remove-zone",id:"Z1"}).zones,[]);
});
test("zones reject invalid bounds, layer, clearance, unknown nets and invalid updates",()=>{
  const p=rc(),q=edit(p,zoneEdit);
  for(const patch of [{net:"MISSING"},{layer:"inner"},{clearance:0},{clearance:Infinity},{bounds:{...zoneEdit.bounds,xMax:30}},{bounds:{...zoneEdit.bounds,yMax:-4}},{bounds:{...zoneEdit.bounds,xMin:NaN}}])
    assert.throws(()=>edit(p,{...zoneEdit,...patch}));
  assert.throws(()=>edit(q,{...zoneEdit,type:"update-zone",id:"Z2"}),/Unknown zone/);
  assert.throws(()=>edit(q,{type:"remove-zone",id:"Z2"}),/Unknown zone/);
  assert.throws(()=>validateProject({...q,zones:[q.zones[0],q.zones[0]]},catalog),/duplicate zone/);
});
test("net deletion and board resize cannot orphan or clip a zone",()=>{
  const p=edit(rc(),zoneEdit),before=JSON.stringify(p);
  assert.throws(()=>edit(p,{type:"remove-net",name:"GND"}),/unknown net/);
  assert.throws(()=>edit(p,{type:"board",width:8,height:8}),/outside board/);
  assert.equal(JSON.stringify(p),before);
  assert.doesNotThrow(()=>edit(edit(p,{type:"remove-zone",id:"Z1"}),{type:"remove-net",name:"GND"}));
});
