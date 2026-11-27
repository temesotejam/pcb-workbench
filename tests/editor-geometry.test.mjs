import test from "node:test";
import assert from "node:assert/strict";
import {modelToSvg,moveFromDrag,fitView,logicalLinks,schematicPinPoint,schematicLinks} from "../site/editor-geometry.js";
import {createProject,applyEdit} from "../site/project-model.js";
const catalog={parts:[{lcsc:"C1",kind:"resistor"},{lcsc:"C2",kind:"capacitor"}]};
test("SVG y axis is reversed; drag snaps to half mm and preserves rotation",()=>{
 assert.deepEqual(modelToSvg({x:3,y:5}),{x:3,y:-5});
 assert.deepEqual(moveFromDrag({x:1,y:2,rotation:90},{x:4,y:7},{x:6.2,y:10.1}),{x:3,y:-1,rotation:90});
 assert.deepEqual(moveFromDrag({x:10000,y:-10000,rotation:0},{x:0,y:0},{x:20,y:20}),{x:10000,y:-10000,rotation:0});
});
test("graphical edit changes only the requested view and preserves net membership",()=>{
 let p=createProject();
 for(const lcsc of ["C1","C2"])p=applyEdit(p,{type:"add-component",lcsc},catalog);
 p=applyEdit(p,{type:"add-net",name:"A"},catalog);
 for(const ref of ["R1","C1"])p=applyEdit(p,{type:"assign-pin",ref,pin:"1",name:"A"},catalog);
 const pos=moveFromDrag(p.components[0].pcb,{x:0,y:0},{x:4,y:-3});
 const q=applyEdit(p,{type:"place",ref:"R1",view:"pcb",...pos},catalog);
 assert.deepEqual(q.components[0].pcb,{x:4,y:3,rotation:0});
 assert.deepEqual(q.components[0].schematic,p.components[0].schematic);
 assert.deepEqual(q.nets,p.nets);
 assert.deepEqual(logicalLinks(q),[{name:"A",from:"R1",to:"C1"}]);
 assert.equal(p.components[0].pcb.x,0);
});
test("fit includes PCB outline and outlying components; empty views stay finite",()=>{
 const p=createProject("test",100,20);
 assert.equal(fitView(p,"pcb")[2],108);
 assert.ok(fitView(p,"schematic").every(Number.isFinite));
 p.components.push({pcb:{x:200,y:-100,rotation:0}});
 const [x,y,w,h]=fitView(p,"pcb");
 assert.ok(x<=-50&&x+w>=200&&y<=-10&&y+h>=100);
});
test("ratlines are per logical net, ignore same-ref duplicates and empty nets",()=>{
 const p={components:[{ref:"R1"},{ref:"R2"},{ref:"C1"}],nets:[{name:"EMPTY",pins:[]},{name:"A",pins:[{ref:"R1"},{ref:"R1"},{ref:"R2"},{ref:"C1"}]}]};
 assert.deepEqual(logicalLinks(p),[{name:"A",from:"R1",to:"R2"},{name:"A",from:"R1",to:"C1"}]);
});

test("schematic pin anchors follow right/up model coordinates and all supported rotations",()=>{
 const expected=[{x:7,y:-5},{x:10,y:-2},{x:13,y:-5},{x:10,y:-8}];
 for(const [i,rotation] of [0,90,180,270].entries()){
  const a=schematicPinPoint({x:10,y:5,rotation},"1"),b=schematicPinPoint({x:10,y:5,rotation},"2");
  assert.deepEqual(a,expected[i]);assert.equal(a.x+b.x,20);assert.equal(a.y+b.y,-10);
 }
});
test("two-pin graphical connection creates a net, extends it and refuses implicit merges atomically",()=>{
 let p=createProject();
 for(const lcsc of ["C1","C2","C1"])p=applyEdit(p,{type:"add-component",lcsc},catalog);
 const a={ref:"R1",pin:"1"},b={ref:"C1",pin:"2"},c={ref:"R2",pin:"1"},d={ref:"R1",pin:"2"};
 const connect=(p,from,to)=>applyEdit(p,{type:"connect-pins",from,to},catalog);
 const q=connect(p,a,b);
 assert.deepEqual(p.nets,[]);
 assert.deepEqual(q.nets,[{name:"Net_1",pins:[a,b]}]);
 assert.deepEqual(connect(q,b,a),q);
 const extended=connect(q,b,c);
 assert.deepEqual(extended.nets[0].pins,[a,b,c]);
 assert.deepEqual(schematicLinks(extended),[{name:"Net_1",from:a,to:b},{name:"Net_1",from:a,to:c}]);
 let conflict=applyEdit(extended,{type:"add-net",name:"GND"},catalog);
 conflict=applyEdit(conflict,{type:"assign-pin",...d,name:"GND"},catalog);
 const snapshot=JSON.stringify(conflict);
 assert.throws(()=>connect(conflict,a,d),/different nets/);
 assert.throws(()=>connect(conflict,a,a),/different pins/);
 assert.throws(()=>connect(conflict,a,{ref:"missing",pin:"1"}),/Unknown/);
 assert.equal(JSON.stringify(conflict),snapshot);
});
test("logical links retain separate pin endpoints on the same component",()=>{
 const p={components:[{ref:"R1"}],nets:[{name:"A",pins:[{ref:"R1",pin:"1"},{ref:"R1",pin:"2"}]}]};
 assert.equal(schematicLinks(p).length,1);
 assert.notDeepEqual(schematicLinks(p)[0].from,schematicLinks(p)[0].to);
});
