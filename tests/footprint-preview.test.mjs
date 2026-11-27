import test from "node:test";
import assert from "node:assert/strict";
import {normalizeFootprint,padPoint,pcbPadLinks} from "../site/footprint-preview.js";
const pad=(pin,x,extra={})=>({type:"pcb_smtpad",layer:"top",shape:"rect",x,y:.2,width:.7,height:.8,port_hints:[pin],...extra});
test("preserve exact rectangular and rotated pad geometry",()=>{
 const p=normalizeFootprint([pad("pin2",1,{shape:"rotated_rect",ccw_rotation:30}),pad("1",-1)]);
 assert.deepEqual(p,[{pin:"1",x:-1,y:.2,shape:"rect",rotation:0,width:.7,height:.8},{pin:"2",x:1,y:.2,shape:"rotated_rect",rotation:30,width:.7,height:.8}]);
});
test("unsupported shape, missing dimensions, layers, pin mapping and holes fail closed",()=>{
 for(const other of [pad("1",1),pad("unknown",1),pad("2",1,{width:0}),pad("2",1,{shape:"polygon"}),pad("2",1,{layer:"bottom"}),pad("2",1,{type:"pcb_plated_hole"}),pad("2",1,{port_hints:["1","2"]}),pad("2",1,{shape:"rotated_rect"})]){
  assert.throws(()=>normalizeFootprint([pad("1",-1),other]));
 }
 assert.throws(()=>normalizeFootprint([pad("1",-1),pad("2",1),pad("2",2)]));
});
test("pad anchors rotate with PCB placement, y is inverted",()=>{
 const p={x:2,y:1};
 for(const [rotation,expected] of [[0,{x:12,y:-6}],[90,{x:9,y:-7}],[180,{x:8,y:-4}],[270,{x:11,y:-3}]])
  {const a=padPoint({x:10,y:5,rotation},p);assert.ok(Math.abs(a.x-expected.x)<1e-10&&Math.abs(a.y-expected.y)<1e-10);}
});
test("pin-level PCB links use correct pad, keep same component connections, skip unresolved nets",()=>{
 const pads=normalizeFootprint([pad("1",-1),pad("2",1)]),f={parts:{C1:{pads}}};
 const p={components:[{ref:"R1",lcsc:"C1"},{ref:"C1",lcsc:"C2"}],nets:[{name:"local",pins:[{ref:"R1",pin:"1"},{ref:"R1",pin:"2"}]},{name:"missing",pins:[{ref:"R1",pin:"1"},{ref:"C1",pin:"2"}]}]};
 const links=pcbPadLinks(p,f);assert.equal(links.length,1);assert.equal(links[0].from.pad.x,-1);assert.equal(links[0].to.pad.x,1);
});

test("draft ratsnest groups transitive routes, restores links after deletion, ignores foreign endpoints",()=>{
 const pads=normalizeFootprint([pad("1",-1),pad("2",1)]),f={parts:{C1:{pads}}};
 const pins=["R1","R2","R3","R4"].map(ref=>({ref,pin:"1"}));
 const p={components:pins.map(({ref})=>({ref,lcsc:"C1"})),nets:[{name:"N",pins}]};
 const a={net:"N",from:pins[0],to:pins[1]},b={net:"N",from:pins[1],to:pins[2]},c={net:"N",from:pins[2],to:pins[3]};
 assert.equal(pcbPadLinks(p,f).length,3);
 assert.equal(pcbPadLinks(p,f,[a,b]).length,1);
 assert.equal(pcbPadLinks(p,f,[a,b,c]).length,0);
 assert.equal(pcbPadLinks(p,f,[a,c]).length,1);
 assert.equal(pcbPadLinks(p,f,[a]).length,2);
 assert.equal(pcbPadLinks(p,f,[{...a,net:"Other"},{...b,to:{ref:"R5",pin:"1"}}]).length,3);
});
test("unrendered routes cannot hide ratlines and unknown pad nets remain explicitly unavailable",()=>{
 const pads=normalizeFootprint([pad("1",-1),pad("2",1)]),f={parts:{C1:{pads}}};
 const from={ref:"R1",pin:"1"},to={ref:"R2",pin:"2"},route={net:"N",from,to};
 const p={components:[{ref:"R1",lcsc:"C1"},{ref:"R2",lcsc:"C1"}],nets:[{name:"N",pins:[from,to]}],routes:[route]};
 assert.equal(pcbPadLinks(p,f).length,1);
 assert.equal(pcbPadLinks(p,f,[route]).length,0);
 assert.deepEqual(pcbPadLinks(p,{parts:{}}),[]);
});
