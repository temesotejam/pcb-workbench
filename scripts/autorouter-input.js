import {routeCopper,routeEndpoint} from "../site/route-geometry.js";
import {splitManualProject} from "./mixed-route-export.js";

// Draft SimpleRouteJson adapter. Does not run the solver or approve fabrication.
// https://github.com/tscircuit/tscircuit-autorouter (MIT)
export function copperObstacles(copper){
  const out=[];
  const rect=(center,width,height,layers,rotation=0)=>{
    if(![center.x,center.y,width,height,rotation].every(Number.isFinite)||width<=0||height<=0)throw new Error("Invalid obstacle geometry");
    return {type:"rect",layers,center:{x:center.x,y:center.y},width,height,ccwRotationDegrees:rotation,connectedTo:[]};
  };
  for(const s of copper.segments){
    const dx=s.to.x-s.from.x,dy=s.to.y-s.from.y,length=Math.hypot(dx,dy);
    if(!["top","bottom"].includes(s.layer)||!Number.isFinite(length)||length<=0||!Number.isFinite(s.width)||s.width<=0)throw new Error("Invalid manual segment obstacle");
    // The oriented rectangle contains the entire round-ended copper capsule.
    out.push(rect({x:(s.from.x+s.to.x)/2,y:(s.from.y+s.to.y)/2},length+s.width,s.width,[s.layer],Math.atan2(dy,dx)*180/Math.PI));
  }
  for(const v of copper.vias){
    if(!Number.isFinite(v.diameter)||v.diameter<=0)throw new Error("Invalid via obstacle");
    // The square conservatively covers the outer copper ring on both layers.
    out.push(rect(v,v.diameter,v.diameter,["top","bottom"]));
  }
  return out;
}

const key=p=>p.ref+":"+p.pin;
const one=(items,label)=>{
  if(items.length!==1)throw new Error("Missing or ambiguous "+label+" (found "+items.length+")");
  return items[0];
};
const finitePositive=n=>Number.isFinite(n)&&n>0;

// Whole manual nets are excluded from routing. All placed pads remain obstacles;
// only pads of an automatic connection receive its connectedTo exemption.
export function buildMixedAutorouterInput(project,footprints,placedJson,{minTraceWidth=.2}={}){
  const {manual,automaticNets}=splitManualProject(project);
  if(!manual.routes.length||!automaticNets.length)throw new Error("Mixed input needs manual and automatic nets");
  if(!finitePositive(minTraceWidth)||!finitePositive(project.board.width)||!finitePositive(project.board.height))throw new Error("Invalid routing input dimensions");
  const wanted=new Set(automaticNets),pinNets=new Map();
  for(const n of project.nets)for(const pin of n.pins){
    if(pinNets.has(key(pin)))throw new Error("Duplicate routing pin assignment");
    pinNets.set(key(pin),n.name);
  }
  const points=new Map(),obstacles=[];
  const byType=t=>placedJson.filter(e=>e.type===t);
  const sourceComponents=byType("source_component"),sourcePorts=byType("source_port"),ports=byType("pcb_port"),pads=byType("pcb_smtpad");
  if(byType("pcb_plated_hole").length||byType("pcb_hole").length)throw new Error("Unsupported non-SMD routing obstacle");
  const seenPads=new Set();
  for(const c of project.components){
    const exact=footprints?.parts?.[c.lcsc]?.pads;
    if(!Array.isArray(exact)||exact.length!==2||new Set(exact.map(p=>p.pin)).size!==2||exact.some(p=>!["1","2"].includes(p.pin)))throw new Error("Exact two-pin footprint unavailable: "+c.ref);
    const sc=one(sourceComponents.filter(e=>e.name===c.ref),"source component "+c.ref);
    for(const pad of exact){
      const pin={ref:c.ref,pin:pad.pin},id=key(pin),center=routeEndpoint(project,footprints,pin);
      const sp=one(sourcePorts.filter(e=>e.source_component_id===sc.source_component_id&&(e.pin_number===Number(pin.pin)||(e.pin_number==null&&e.name==="pin"+pin.pin))),"source pin "+id);
      const port=one(ports.filter(e=>e.source_port_id===sp.source_port_id),"PCB port "+id);
      const physical=one(pads.filter(e=>e.pcb_port_id===port.pcb_port_id),"physical pad "+id);
      if(seenPads.has(physical)||physical.layer!=="top"||!port.layers?.includes("top"))throw new Error("Unsupported or duplicate placed pad "+id);
      seenPads.add(physical);
      for(const p of [port,physical])if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.hypot(p.x-center.x,p.y-center.y)>1e-5)throw new Error("Routing pad position mismatch: "+id);
      let width,height,rotation;
      if(pad.shape==="circle"&&finitePositive(pad.radius)){width=height=2*pad.radius;rotation=0}
      else if(["rect","rotated_rect"].includes(pad.shape)&&finitePositive(pad.width)&&finitePositive(pad.height)&&Number.isFinite(pad.rotation)&&Number.isFinite(c.pcb.rotation)){width=pad.width;height=pad.height;rotation=c.pcb.rotation+pad.rotation}
      else throw new Error("Unsupported routing pad geometry: "+id);
      const name=pinNets.get(id);
      obstacles.push({type:"rect",layers:["top"],center,width,height,ccwRotationDegrees:rotation,connectedTo:wanted.has(name)?[name]:[]});
      points.set(id,{...center,layer:"top"});
    }
  }
  if(seenPads.size!==pads.length)throw new Error("Unexpected placed pad outside registered footprint subset");
  for(const route of manual.routes)obstacles.push(...copperObstacles(routeCopper(project,footprints,route)));
  const bounds={minX:-project.board.width/2,maxX:project.board.width/2,minY:-project.board.height/2,maxY:project.board.height/2};
  const connections=project.nets.filter(n=>wanted.has(n.name)).map(n=>({name:n.name,pointsToConnect:n.pins.map(pin=>{
    const p=points.get(key(pin));
    if(!p||p.x<bounds.minX||p.x>bounds.maxX||p.y<bounds.minY||p.y>bounds.maxY)throw new Error("Missing or out-of-board routing terminal: "+key(pin));
    return p;
  })}));
  return {layerCount:2,minTraceWidth,obstacles,connections,bounds};
}
