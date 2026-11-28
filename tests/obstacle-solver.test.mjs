import test from "node:test";
import assert from "node:assert/strict";
import {topSolverInput,validateTopResult,solveTopCandidate,appendCandidate} from "../scripts/obstacle-solver.js";
const input={layerCount:2,minTraceWidth:.2,bounds:{minX:-5,maxX:5,minY:-5,maxY:5},connections:[{name:"RETURN",pointsToConnect:[{x:-4,y:0,layer:"top"},{x:4,y:0,layer:"top"}]}],obstacles:[{type:"rect",layers:["top"],center:{x:0,y:0},width:1,height:2,connectedTo:[]},{type:"rect",layers:["bottom"],center:{x:0,y:2},width:1,height:1,connectedTo:[]}]};
const out=points=>({traces:[{type:"pcb_trace",route:points.map(([x,y])=>({route_type:"wire",x,y,width:.2,layer:"top"}))}]});
const detour=out([[-4,0],[-2,2],[2,2],[4,0]]);
test("single-layer solver input preserves original and expands foreign copper",()=>{
 const before=JSON.stringify(input),p=topSolverInput(input);
 assert.equal(p.layerCount,1);assert.equal(p.obstacles.length,1);
 assert.equal(p.obstacles[0].width,1.4);assert.equal(p.bounds.minX,-4.5);
 assert.equal(JSON.stringify(input),before);
});
test("detour accepted, straight crossing and insufficient clearance rejected",()=>{
 assert.deepEqual(validateTopResult(input,detour),{name:"RETURN",width:.2,waypoints:[{x:-2,y:2},{x:2,y:2}],segments:3});
 assert.throws(()=>validateTopResult(input,out([[-4,0],[4,0]])),/copper clearance/);
 assert.throws(()=>validateTopResult(input,out([[-4,0],[-2,1.1],[2,1.1],[4,0]])),/copper clearance/);
 assert.throws(()=>validateTopResult(input,out([[-4,0],[-2,4.49],[4,0]])),/board-edge/);
});
test("rejects wrong endpoints, vias, changed widths and missing routes",()=>{
 assert.throws(()=>validateTopResult(input,out([[-3,0],[4,0]])),/terminal identity/);
 const via=structuredClone(detour);via.traces[0].route[1].route_type="via";
 assert.throws(()=>validateTopResult(input,via),/unsupported route/);
 const width=structuredClone(detour);width.traces[0].route[1].width=.3;
 assert.throws(()=>validateTopResult(input,width),/variable width/);
 assert.throws(()=>validateTopResult(input,{traces:[]}),/exactly one/);
 assert.throws(()=>topSolverInput({...input,connections:[]}),/requires one/);
});
test("solver adapter accepts reversed result and rejects explicit solver failure",()=>{
 class Good{step(){this.solved=true}getOutputSimpleRouteJson(){return out([[4,0],[2,2],[-2,2],[-4,0]])}}
 class Bad{step(){this.failed=true;this.error="test"}}
 assert.equal(solveTopCandidate(input,Good).segments,3);
 assert.throws(()=>solveTopCandidate(input,Bad),/solver failed: test/);
});
test("draft append keeps existing manual route immutable and rejects replacement",()=>{
 const project={nets:[{name:"RETURN",pins:[{ref:"R1",pin:"2"},{ref:"R2",pin:"2"}]}],routes:[{id:"T1",net:"SUPPLY"}]};
 const before=JSON.stringify(project),candidate=validateTopResult(input,detour),p=appendCandidate(project,candidate);
 assert.equal(p.routes[1].id,"T2");assert.deepEqual(p.routes[1].from,{ref:"R1",pin:"2"});
 assert.equal(JSON.stringify(project),before);
 assert.throws(()=>appendCandidate(p,candidate),/not untouched/);
});
