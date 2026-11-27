import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {applyEdit,validateProject,inspectProject} from "../site/project-model.js";
import {projectToCircuitPlan} from "../scripts/project-adapter.js";
import {routePoints,routeCopper,parseWaypoints,beginRouteDraft,appendRouteWaypoint,finishRouteDraft,snapRoutePoint} from "../site/route-geometry.js";
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

import {injectManualRoutes,requireCompleteManualRoutes,verifyKicadManualSegments} from "../scripts/manual-route-export.js";
function manualCase(){
  const p=fixture();
  p.routes=p.nets.map((n,i)=>({id:"T"+(i+1),net:n.name,layer:"top",width:.25,from:n.pins[0],to:n.pins[1],waypoints:[{x:0,y:i? -4:4}]}));
  const f=syntheticGeometry(p),json=[],aliases=new Map(p.nets.map((n,i)=>["alias"+i,n.name]));
  for(const c of p.components){
    json.push({type:"source_component",name:c.ref,source_component_id:c.ref});
    for(const pin of ["1","2"]){
      const id=c.ref+":"+pin,local=f.parts[c.lcsc].pads.find(p=>p.pin===pin),x=c.pcb.x+local.x,y=c.pcb.y+local.y;
      json.push({type:"source_port",source_component_id:c.ref,source_port_id:id,pin_number:Number(pin)},
        {type:"pcb_port",source_port_id:id,pcb_port_id:"P"+id,layers:["top"],x,y},
        {type:"pcb_smtpad",pcb_port_id:"P"+id,layer:"top",x,y});
    }
  }
  for(const [alias,name] of aliases){
    json.push({type:"source_net",name:alias,source_net_id:alias,subcircuit_connectivity_map_key:"key_"+alias});
    for(const pin of p.nets.find(n=>n.name===name).pins)json.push({type:"source_trace",source_trace_id:alias+pin.ref,connected_source_net_ids:[alias],connected_source_port_ids:[pin.ref+":"+pin.pin]});
  }
  return {p,f,json,aliases};
}
test("manual export opt-in preserves explicit route data and leaves legacy refusal intact",()=>{
  const {p}=manualCase();
  assert.throws(()=>projectToCircuitPlan(p,catalog),/refusing to substitute autorouting/);
  const plan=projectToCircuitPlan(p,catalog,{allowManual:true});
  assert.deepEqual(plan.manualProject,p);assert.notEqual(plan.manualProject,p);assert.equal(plan.orderReady,false);
});
test("complete explicit manual graph compiles exact wire coordinates, widths and net identities",()=>{
  const {p,f,json,aliases}=manualCase(),before=JSON.stringify(json);
  const out=injectManualRoutes(json,p,f,aliases),traces=out.filter(e=>e.type==="pcb_trace");
  assert.equal(traces.length,2);
  for(const [i,t] of traces.entries()){
    assert.deepEqual(t.route.map(({x,y})=>({x,y})),routePoints(p,f,p.routes[i]));
    assert.ok(t.route.every(r=>r.width===.25&&r.layer==="top"));
    assert.equal(t.subcircuit_connectivity_map_key,"key_alias"+i);
    assert.equal(t.route[0].start_pcb_port_id,"P"+p.routes[i].from.ref+":"+p.routes[i].from.pin);
  }
  assert.equal(JSON.stringify(json),before);
});
test("manual export rejects missing net, geometry drift, missing physical pad and existing copper",()=>{
  const {p,f,json,aliases}=manualCase();
  assert.throws(()=>requireCompleteManualRoutes({...p,routes:p.routes.slice(0,1)}),/Manual net incomplete/);
  const shifted=json.map(e=>e.type==="pcb_smtpad"?{...e,x:e.x+.1}:e);
  assert.throws(()=>injectManualRoutes(shifted,p,f,aliases),/pad position mismatch/);
  assert.throws(()=>injectManualRoutes(json.filter(e=>e.type!=="pcb_smtpad"),p,f,aliases),/physical pad/);
  assert.throws(()=>injectManualRoutes([...json,{type:"pcb_trace"}],p,f,aliases),/existing copper/);
  assert.throws(()=>injectManualRoutes(json,p,{},aliases),/Exact pad unavailable/);
});

test("serialized KiCad parity rejects changed waypoint, width, net, layer or extra copper",()=>{
  const {p,f,json,aliases}=manualCase(),out=injectManualRoutes(json,p,f,aliases);
  const header=p.nets.map((n,i)=>'(net '+(i+1)+' "/'+n.name+'")').join("\n");
  const blocks=out.filter(e=>e.type==="pcb_trace").flatMap((t,i)=>t.route.slice(1).map((b,j)=>{
    const a=t.route[j];
    return '(segment (start '+(100+a.x)+' '+(100-a.y)+') (end '+(100+b.x)+' '+(100-b.y)+') (width '+a.width+') (layer "F.Cu") (net '+(i+1)+'))';
  }));
  const verify=b=>verifyKicadManualSegments(header,b,out,p);
  assert.deepEqual(verify(blocks),{routes:2,segments:4,coordinateResolutionMm:.00001,physicalDrcVerified:false,orderReady:false});
  assert.equal(verify(blocks.map(b=>b.replace('"F.Cu"','F.Cu'))).segments,4);
  for(const changed of [
    blocks[0].replace("(end 100 96)","(end 100 95.5)"),
    blocks[0].replace("(width 0.25)","(width 0.3)"),
    blocks[0].replace("(net 1)","(net 2)"),
    blocks[0].replace('"F.Cu"','"B.Cu"')
  ])assert.throws(()=>verify([changed,...blocks.slice(1)]));
  assert.throws(()=>verify([...blocks,blocks[0]]),/parity mismatch/);
});


test("two-layer draft preserves via dimensions and alternates layers without losing legacy routes",()=>{
  const p=fixture(),d=draft(p),via={diameter:.7,drill:.3};
  const waypoints=parseWaypoints("0,-2,0.7,0.3\n0,0\n0,2,0.7,0.3");
  const q=edit(p,{...d,waypoints});
  assert.deepEqual(q.routes[0].waypoints,waypoints);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(q)),catalog),q);
  const copper=routeCopper(q,syntheticGeometry(p),q.routes[0]);
  assert.deepEqual(copper.segments.map(s=>s.layer),["top","bottom","bottom","top"]);
  assert.deepEqual(copper.vias,[{x:0,y:-2,...via},{x:0,y:2,...via}]);
  assert.throws(()=>projectToCircuitPlan(q,catalog,{allowManual:true}),/refusing to omit vias/);
  assert.equal(inspectProject(q,catalog).orderReady,false);
  assert.deepEqual(routeCopper(p,syntheticGeometry(p),d).segments.map(s=>s.layer),["top","top"]);
});
test("via draft rejects odd transitions, invalid holes/rings, board edge and malformed waypoint rows",()=>{
  const p=fixture(),d=draft(p),via={diameter:.7,drill:.3},pts=[{x:0,y:-2,via},{x:0,y:2,via}];
  assert.throws(()=>edit(p,{...d,waypoints:pts.slice(0,1)}),/even number/);
  for(const bad of [{diameter:.3,drill:.3},{diameter:.7,drill:0},{diameter:.7,drill:NaN},{diameter:.2,drill:.1},null]){
    assert.throws(()=>edit(p,{...d,waypoints:[{...pts[0],via:bad},pts[1]]}),/via/);
  }
  assert.throws(()=>edit(p,{...d,waypoints:[{...pts[0],x:p.board.width/2-.2},pts[1]]}),/Via outside board/);
  assert.throws(()=>parseWaypoints("0,1,.7"),/Waypoint format/);
  assert.throws(()=>parseWaypoints("0,1,.7,"),/Waypoint format/);
  const q=edit(p,{...d,waypoints:pts});
  assert.throws(()=>edit(q,{type:"board",width:.5,height:p.board.height}),/Board dimensions/);
});
