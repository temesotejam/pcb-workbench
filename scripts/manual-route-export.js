import {routePoints} from "../site/route-geometry.js";

const key=p=>p.ref+":"+p.pin;
function one(items,message){
  if(items.length!==1)throw new Error(message+" (found "+items.length+")");
  return items[0];
}
function assertNear(a,b,message){
  if(!Number.isFinite(a.x)||!Number.isFinite(a.y)||Math.hypot(a.x-b.x,a.y-b.y)>1e-5)throw new Error(message);
}

// Explicit pad-to-pad graph only: do not infer connections from crossing traces,
// and never fill missing nets with automatic copper.
export function requireCompleteManualRoutes(project){
  for(const n of project.nets){
    const adjacent=new Map(n.pins.map(p=>[key(p),[]]));
    for(const t of project.routes.filter(t=>t.net===n.name)){
      const a=key(t.from),b=key(t.to);
      if(!adjacent.has(a)||!adjacent.has(b))throw new Error("Unknown manual route endpoint");
      adjacent.get(a).push(b);adjacent.get(b).push(a);
    }
    const start=key(n.pins[0]),seen=new Set([start]),stack=[start];
    while(stack.length)for(const next of adjacent.get(stack.pop()))if(!seen.has(next)){seen.add(next);stack.push(next)}
    if(seen.size!==n.pins.length)throw new Error("Manual net incomplete: "+n.name);
  }
}

// Input is the engine's placed, UNROUTED Circuit JSON. Match the actual
// source pin, PCB port and physical pad, and compare against editor geometry.
// A discrepancy is an error, not permission to shift the user's copper.
export function injectManualRoutes(json,project,footprints,aliases){
  requireCompleteManualRoutes(project);
  if(json.some(e=>["pcb_trace","pcb_via","pcb_copper_pour"].includes(e.type)))throw new Error("Unexpected existing copper; manual mode refuses replacement");
  const byType=type=>json.filter(e=>e.type===type);
  const sourceComponents=byType("source_component"),sourcePorts=byType("source_port"),ports=byType("pcb_port"),pads=byType("pcb_smtpad"),sourceNets=byType("source_net"),sourceTraces=byType("source_trace");
  const aliasByName=new Map([...aliases].map(([alias,name])=>[name,alias]));
  const findEndpoint=(pin,point)=>{
    const c=one(sourceComponents.filter(e=>e.name===pin.ref),"Missing or ambiguous source component "+pin.ref);
    const s=one(sourcePorts.filter(e=>e.source_component_id===c.source_component_id&&(e.pin_number===Number(pin.pin)||(e.pin_number==null&&e.name==="pin"+pin.pin))),"Missing or ambiguous source pin "+key(pin));
    const port=one(ports.filter(e=>e.source_port_id===s.source_port_id),"Missing or ambiguous PCB port "+key(pin));
    const pad=one(pads.filter(e=>e.pcb_port_id===port.pcb_port_id),"Missing or ambiguous physical pad "+key(pin));
    if(pad.layer!=="top"||!port.layers?.includes("top"))throw new Error("Manual route needs a top SMD pad: "+key(pin));
    assertNear(port,point,"Editor / PCB port position mismatch: "+key(pin));
    assertNear(pad,point,"Editor / PCB pad position mismatch: "+key(pin));
    return {source:s,port};
  };
  const traces=project.routes.map(t=>{
    const points=routePoints(project,footprints,t);
    const a=findEndpoint(t.from,points[0]),b=findEndpoint(t.to,points.at(-1));
    const alias=aliasByName.get(t.net);
    const net=one(sourceNets.filter(e=>e.name===alias),"Missing or ambiguous engine net "+t.net);
    const related=sourceTraces.filter(e=>e.connected_source_net_ids?.includes(net.source_net_id));
    const start=one(related.filter(e=>e.connected_source_port_ids?.includes(a.source.source_port_id)),"Source trace / manual start mismatch: "+t.id);
    one(related.filter(e=>e.connected_source_port_ids?.includes(b.source.source_port_id)),"Source trace / manual end mismatch: "+t.id);
    const connectivity=net.subcircuit_connectivity_map_key||net.source_net_id;
    if(!connectivity||!start.source_trace_id)throw new Error("Missing source connectivity identity");
    return {type:"pcb_trace",pcb_trace_id:"pcb_trace_manual_"+t.id,source_trace_id:start.source_trace_id,subcircuit_connectivity_map_key:connectivity,
      route:points.map((p,i)=>({route_type:"wire",x:p.x,y:p.y,width:t.width,layer:"top",...(i===0?{start_pcb_port_id:a.port.pcb_port_id}:{}),...(i===points.length-1?{end_pcb_port_id:b.port.pcb_port_id}:{})}))};
  });
  return [...json,...traces];
}
