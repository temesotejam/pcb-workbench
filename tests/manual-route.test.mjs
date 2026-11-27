import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {applyEdit,validateProject,inspectProject} from "../site/project-model.js";
import {projectToCircuitPlan} from "../scripts/project-adapter.js";
import {routePoints,parseWaypoints,beginRouteDraft,appendRouteWaypoint,finishRouteDraft,snapRoutePoint} from "../site/route-geometry.js";
const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url),"utf8"));
const catalog=read("../library/catalog.json");
const fixture=()=>read("../projects/native-resistors/native.json");
const edit=(p,e)=>applyEdit(p,e,catalog);
function draft(p){const n=p.nets[0];return {type:"add-route",from:n.pins[0],to:n.pins[1],width:.25,waypoints:[{x:0,y:4}]}}
test("legacy fixture stays convertible; route survives JSON and cannot silently autoroute",()=>{
  const p=fixture(),q=edit(p,draft(p));
  assert.equal(p.routes,undefined);assert.equal(q.routes[0].layer,"top");
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(q)),catalog),q);
  assert.equal(inspectProject(q,catalog).orderReady,false);
  assert.throws(()=>projectToCircuitPlan(q,catalog),/refusing to substitute autorouting/);
  assert.doesNotThrow(()=>projectToCircuitPlan(edit(q,{type:"remove-route",id:"T1"}),catalog));
});
test("invalid net endpoints, reversed duplicates, width, points and layer rejected",()=>{
  const p=fixture(),d=draft(p),q=edit(p,d);
  assert.throws(()=>edit(p,{...d,to:p.nets[1].pins[0]}),/same logical net/);
  assert.throws(()=>edit(q,{...d,from:d.to,to:d.from}),/Duplicate pad pair/);
  assert.throws(()=>edit(p,{...d,width:0}),/width/);
  assert.throws(()=>edit(p,{...d,waypoints:[{x:100,y:0}]}),/outside board/);
  assert.throws(()=>edit(p,{...d,waypoints:[{x:0,y:4},{x:0,y:4}]}),/Repeated/);
  assert.throws(()=>validateProject({...q,routes:[{...q.routes[0],layer:"bottom"}]},catalog),/layer/);
});
test("attached components and nets cannot be silently changed or deleted",()=>{
  const p=fixture(),q=edit(p,draft(p)),t=q.routes[0],c=q.components.find(c=>c.ref===t.from.ref);
  for(const e of [{type:"remove-component",ref:c.ref},{type:"remove-net",name:t.net},{type:"assign-pin",ref:c.ref,pin:t.from.pin,name:null},{type:"place",view:"pcb",ref:c.ref,...c.pcb,x:c.pcb.x+1}])assert.throws(()=>edit(q,e));
  assert.doesNotThrow(()=>edit(q,{type:"place",view:"schematic",ref:c.ref,...c.schematic,x:c.schematic.x+1}));
});
test("geometry uses actual supplied pad centers, positive Y up, and rejects missing or out-of-board geometry",()=>{
  const p=fixture(),q=edit(p,draft(p)),t=q.routes[0];
  const synthetic={parts:Object.fromEntries(p.components.map(c=>[c.lcsc,{pads:[{pin:"1",x:-.5,y:.25},{pin:"2",x:.5,y:.25}]}]))};
  const pts=routePoints(q,synthetic,t);
  assert.equal(pts.length,3);assert.deepEqual(pts[1],{x:0,y:4});
  assert.throws(()=>routePoints(q,{},t),/Exact pad unavailable/);
  const c=q.components.find(c=>c.ref===t.from.ref);
  const rotated={...q,components:q.components.map(v=>v.ref===c.ref?{...v,pcb:{x:0,y:0,rotation:90}}:v)};
  const first=routePoints(rotated,synthetic,t)[0];
  assert.ok(Math.abs(first.x+.25)<1e-9);assert.ok(Math.abs(first.y-(t.from.pin==="1"?-.5:.5))<1e-9);
  assert.throws(()=>routePoints({...q,board:{width:1,height:1}},synthetic,t),/outside board/);
  assert.deepEqual(parseWaypoints("0,4\n 2,-3"),[{x:0,y:4},{x:2,y:-3}]);
  assert.throws(()=>parseWaypoints("1,"));assert.throws(()=>parseWaypoints("1,NaN"));
});

const syntheticGeometry=p=>({parts:Object.fromEntries(p.components.map(c=>[c.lcsc,{pads:[{pin:"1",x:-.5,y:.25},{pin:"2",x:.5,y:.25}]}]))});
test("graphical draft adds snapped waypoints without mutating project, then commits exact route",()=>{
  const p=fixture(),f=syntheticGeometry(p),n=p.nets[0],initial=JSON.stringify(p);
  const a=beginRouteDraft(p,f,n.pins[0],.25);
  const b=appendRouteWaypoint(p,a,{x:.13,y:-4.12});
  assert.deepEqual(a.waypoints,[]);
  assert.deepEqual(b.waypoints,[{x:.25,y:4}]);
  assert.deepEqual(snapRoutePoint({x:-.14,y:2.13}),{x:-.25,y:-2.25});
  const q=edit(p,finishRouteDraft(p,f,b,n.pins[1]));
  assert.equal(q.routes[0].width,.25);
  assert.deepEqual(q.routes[0].waypoints,b.waypoints);
  assert.equal(JSON.stringify(p),initial);
  assert.deepEqual(routePoints(q,f,q.routes[0])[0],a.start);
});
test("graphical route rejects unassigned, missing, wrong-net and same pad endpoints",()=>{
  const p=fixture(),f=syntheticGeometry(p),n=p.nets[0],from=n.pins[0],a=beginRouteDraft(p,f,from,.25);
  assert.throws(()=>beginRouteDraft(p,{},from,.25),/Exact pad unavailable/);
  assert.throws(()=>beginRouteDraft(p,f,{ref:"UNKNOWN",pin:"1"},.25),/not assigned/);
  assert.throws(()=>beginRouteDraft(p,f,from,0),/width/);
  assert.throws(()=>finishRouteDraft(p,f,a,p.nets[1].pins[0]),/same logical net/);
  assert.throws(()=>finishRouteDraft(p,f,a,from),/different pads/);
});
test("graphical draft rejects repeated and out-of-board points without corrupting draft",()=>{
  const p=fixture(),f=syntheticGeometry(p),a=beginRouteDraft(p,f,p.nets[0].pins[0],.25);
  const b=appendRouteWaypoint(p,a,{x:0,y:-4});
  assert.throws(()=>appendRouteWaypoint(p,b,{x:0,y:-4}),/Repeated/);
  assert.throws(()=>appendRouteWaypoint(p,b,{x:1000,y:0}),/outside board/);
  assert.deepEqual(b.waypoints,[{x:0,y:4}]);
  assert.throws(()=>appendRouteWaypoint(p,{...b,waypoints:Array.from({length:100},(_,i)=>({x:i,y:4}))},{x:0,y:0}),/Too many/);
});
