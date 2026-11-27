import {routePoints,routeCopper} from "../site/route-geometry.js";

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
    const copper=routeCopper(project,footprints,t);
    const a=findEndpoint(t.from,points[0]),b=findEndpoint(t.to,points.at(-1));
    const alias=aliasByName.get(t.net);
    const net=one(sourceNets.filter(e=>e.name===alias),"Missing or ambiguous engine net "+t.net);
    const related=sourceTraces.filter(e=>e.connected_source_net_ids?.includes(net.source_net_id));
    const start=one(related.filter(e=>e.connected_source_port_ids?.includes(a.source.source_port_id)),"Source trace / manual start mismatch: "+t.id);
    one(related.filter(e=>e.connected_source_port_ids?.includes(b.source.source_port_id)),"Source trace / manual end mismatch: "+t.id);
    const connectivity=net.subcircuit_connectivity_map_key||net.source_net_id;
    if(!connectivity||!start.source_trace_id)throw new Error("Missing source connectivity identity");
    // The pinned converter uses the outgoing wire point's layer. Place a
    // wire on each side of a via at the identical coordinate; its zero-length
    // transitions are skipped by AddTracesStage, and AddViasStage emits the hole.
    const wire=(p,layer,extra={})=>({route_type:"wire",x:p.x,y:p.y,width:t.width,layer,...extra});
    const route=[wire(points[0],"top",{start_pcb_port_id:a.port.pcb_port_id})];
    for(const [i,s] of copper.segments.entries()){
      const p=points[i+1],last=i===copper.segments.length-1;
      route.push(wire(p,s.layer,last?{end_pcb_port_id:b.port.pcb_port_id}:{}));
      if(p.via){
        const next=copper.segments[i+1].layer;
        route.push({route_type:"via",x:p.x,y:p.y,from_layer:s.layer,to_layer:next,outer_diameter:p.via.diameter,hole_diameter:p.via.drill});
        route.push(wire(p,next));
      }
    }
    return {type:"pcb_trace",pcb_trace_id:"pcb_trace_manual_"+t.id,source_trace_id:start.source_trace_id,subcircuit_connectivity_map_key:connectivity,route};
  });
  return [...json,...traces];
}

// Compare the serialized KiCad output, not just the in-memory routes.
// The pinned converter v0.0.282 maps (x,y) -> (100+x,100-y) in mm.
// A changed converter transform or serialization fails closed.
export function verifyKicadManualSegments(pcbText,segmentBlocks,json,project,viaBlocks=[]){
  const netIds=new Map();
  for(const m of pcbText.matchAll(/\(net\s+(\d+)\s+"([^"]*)"\s*\)/g)){
    const id=Number(m[1]),name=m[2];
    if(netIds.has(name)&&netIds.get(name)!==id)throw new Error("Ambiguous serialized KiCad net: "+name);
    netIds.set(name,id);
  }
  const number=n=>{
    const v=Number(n);
    if(!Number.isFinite(v))throw new Error("Invalid KiCad segment coordinate/width");
    return Math.round(v*1e5)||0;
  };
  const signature=(a,b,w,layer,net)=>{
    if(!Number.isInteger(net)||net<=0||!["F.Cu","B.Cu"].includes(layer)||!(Number(w)>0))throw new Error("Invalid manual KiCad segment layer, width or net");
    const ends=[a,b].map(p=>[number(p.x),number(p.y)].join(",")).sort();
    return [net,layer,number(w),...ends].join("|");
  };
  const expected=[],expectedVias=[];
  const viaSignature=(p,size,drill,net)=>{
    if(!Number.isInteger(net)||net<=0||!(Number(drill)>0)||!(Number(size)>Number(drill)))throw new Error("Invalid serialized via geometry or net");
    return [net,number(p.x),number(p.y),number(size),number(drill)].join("|");
  };
  for(const t of project.routes){
    const trace=one(json.filter(e=>e.type==="pcb_trace"&&e.pcb_trace_id==="pcb_trace_manual_"+t.id),"Missing compiled route "+t.id);
    const net=netIds.get("/"+t.net);
    if(!net)throw new Error("Manual route KiCad net missing: "+t.net);
    const transform=p=>({x:100+p.x,y:100-p.y});
    // Derive the expected geometry from the original model, not from emitted
    // via points. Only the two exact pad centers come from the compiled trace.
    const points=[trace.route[0],...t.waypoints,trace.route.at(-1)];
    let layer="F.Cu";
    for(let i=1;i<points.length;i++){
      const p=points[i];
      expected.push(signature(transform(points[i-1]),transform(p),t.width,layer,net));
      if(p.via){
        expectedVias.push(viaSignature(transform(p),p.via.diameter,p.via.drill,net));
        layer=layer==="F.Cu"?"B.Cu":"F.Cu";
      }
    }
    if(layer!=="F.Cu")throw new Error("Manual route must return to top");
  }
  const field=(block,re,name)=>{
    const m=block.match(re);
    if(!m)throw new Error("Missing serialized segment "+name);
    return m;
  };
  const actual=segmentBlocks.map(block=>{
    const a=field(block,/\(start\s+([^\s()]+)\s+([^\s()]+)\s*\)/,"start"),b=field(block,/\(end\s+([^\s()]+)\s+([^\s()]+)\s*\)/,"end");
    const width=field(block,/\(width\s+([^\s()]+)\s*\)/,"width")[1];
    const layerMatch=field(block,/\(layer\s+(?:"([^"]+)"|([^\s()"]+))\s*\)/,"layer");
    const layer=layerMatch[1]??layerMatch[2];
    const net=Number(field(block,/\(net\s+(\d+)\s*\)/,"net")[1]);
    return signature({x:a[1],y:a[2]},{x:b[1],y:b[2]},width,layer,net);
  });
  expected.sort();actual.sort();
  if(expected.length!==actual.length||expected.some((s,i)=>s!==actual[i]))throw new Error("Serialized KiCad manual segment parity mismatch: expected "+expected.length+", actual "+actual.length+", first difference "+JSON.stringify({expected:expected.find((s,i)=>s!==actual[i]),actual:actual.find((s,i)=>s!==expected[i])}));
  const actualVias=viaBlocks.map(block=>{
    const at=field(block,/\(at\s+([^\s()]+)\s+([^\s()]+)\s*\)/,"via at");
    const size=field(block,/\(size\s+([^\s()]+)\s*\)/,"via size")[1];
    const drill=field(block,/\(drill\s+([^\s()]+)\s*\)/,"via drill")[1];
    const layers=field(block,/\(layers\s+([^()]+)\)/,"via layers")[1].trim().split(/\s+/).map(s=>s.replace(/^"|"$/g,"")).sort();
    if(layers.join("|")!=="B.Cu|F.Cu"||/^\(via\s+(blind|micro)\b/.test(block))throw new Error("Via must span both copper layers");
    const net=Number(field(block,/\(net\s+(\d+)\s*\)/,"via net")[1]);
    return viaSignature({x:at[1],y:at[2]},size,drill,net);
  });
  expectedVias.sort();actualVias.sort();
  if(expectedVias.length!==actualVias.length||expectedVias.some((s,i)=>s!==actualVias[i]))throw new Error("Serialized KiCad manual via parity mismatch: expected "+JSON.stringify(expectedVias)+", actual "+JSON.stringify(actualVias));
  return {routes:project.routes.length,segments:expected.length,vias:expectedVias.length,coordinateResolutionMm:0.00001,physicalDrcVerified:false,orderReady:false};
}
