import {requireCompleteManualRoutes} from "./manual-route-export.js";

// Whole nets are either explicit manual or automatic. A partially hand-routed
// net is never silently completed/replaced.
export function splitManualProject(project){
  const names=new Set(project.routes.map(t=>t.net));
  const manual={...project,nets:project.nets.filter(n=>names.has(n.name))};
  if(names.size!==manual.nets.length)throw new Error("Unknown manual net");
  requireCompleteManualRoutes(manual);
  return {manual,automaticNets:project.nets.filter(n=>!names.has(n.name)).map(n=>n.name)};
}

// The pinned engine proposes copper for all nets. Discard its manual-net
// copper, retain positively identified untouched-net wire routes only.
// Manual copper is not yet an obstacle to the router: independent DRC must
// reject collisions. Automatic vias need an independent drill audit first.
export function prepareMixedRouting(json,automaticNets,aliases){
  const wanted=new Set(automaticNets),seen=new Set(),retained=[];
  const byId=new Map(),byKey=new Map(),byTrace=new Map();
  function register(map,key,value){
    if(key==null||key==="")return;
    if(map.has(key)&&map.get(key)!==value)throw new Error("Ambiguous automatic route net identity");
    map.set(key,value);
  }
  for(const n of json.filter(e=>e.type==="source_net")){
    const name=aliases.get(n.name);
    if(!name||!n.source_net_id)throw new Error("Unknown engine source net in mixed routing");
    register(byId,n.source_net_id,name);
    register(byKey,n.source_net_id,name);
    register(byKey,n.subcircuit_connectivity_map_key,name);
  }
  for(const t of json.filter(e=>e.type==="source_trace")){
    const ids=t.connected_source_net_ids??[];
    if(ids.length!==1||!byId.has(ids[0]))continue;
    const name=byId.get(ids[0]);
    register(byTrace,t.source_trace_id,name);
    register(byKey,t.subcircuit_connectivity_map_key,name);
  }
  const unrouted=json.filter(e=>{
    if(["pcb_via","pcb_copper_pour","pcb_trace_hint"].includes(e.type))throw new Error("Unsupported standalone copper in mixed routing: "+e.type);
    if(e.type!=="pcb_trace")return true;
    const a=byTrace.get(e.source_trace_id),b=byKey.get(e.subcircuit_connectivity_map_key);
    if((a&&b&&a!==b)||(!a&&!b))throw new Error("Cannot identify automatic trace net: "+e.pcb_trace_id);
    const name=a??b;
    if(!wanted.has(name))return false;
    if(!Array.isArray(e.route)||e.route.length<2||e.route.some(p=>p.route_type!=="wire"||!["top","bottom"].includes(p.layer)||![p.x,p.y,p.width].every(Number.isFinite)||p.width<=0))throw new Error("Mixed automatic routing supports wire-only copper: "+name);
    if(e.route.some((p,i)=>i&&p.layer!==e.route[i-1].layer))throw new Error("Automatic layer transition without verified via: "+name);
    retained.push(e);seen.add(name);return false;
  });
  for(const name of wanted)if(!seen.has(name))throw new Error("Automatic net has no routed copper: "+name);
  return {unrouted,retained};
}

// Validate every actual segment net ID before limiting exact geometry parity
// to manual nets. Unknown and absent automatic nets fail closed.
export function mixedManualSegmentBlocks(pcbText,blocks,manualNets,automaticNets){
  const manual=new Set(manualNets),automatic=new Set(automaticNets),byId=new Map(),seen=new Set();
  for(const m of pcbText.matchAll(/\(net\s+(\d+)\s+"([^"]*)"\s*\)/g)){
    const id=Number(m[1]),name=m[2];
    if(byId.has(id)&&byId.get(id)!==name)throw new Error("Ambiguous serialized mixed net");
    byId.set(id,name);
  }
  const kept=blocks.filter(b=>{
    const m=b.match(/\(net\s+(\d+)\s*\)/),name=m?byId.get(Number(m[1])):null;
    if(!name||!name.startsWith("/"))throw new Error("Unknown serialized mixed segment net");
    const local=name.slice(1);
    if(manual.has(local))return true;
    if(!automatic.has(local))throw new Error("Unexpected serialized mixed segment net: "+local);
    seen.add(local);return false;
  });
  for(const name of automatic)if(!seen.has(name))throw new Error("Missing serialized automatic net: "+name);
  return kept;
}
