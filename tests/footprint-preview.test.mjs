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
