// Conservative draft adapter for the pinned MIT capacity-autorouter.
// Sequential untouched two-terminal top-pad nets; opt-in audited through-vias.
import {copperObstacles} from "./autorouter-input.js";
const clearance=.2, edge=.5, eps=1e-6;
const near=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)<=eps;
const fail=m=>{throw new Error("Obstacle router: "+m)};
function rectangle(o){
  if(o.type!=="rect"||![o.center?.x,o.center?.y,o.width,o.height,o.ccwRotationDegrees??0].every(Number.isFinite)||o.width<=0||o.height<=0)fail("invalid rectangle");
  const t=(o.ccwRotationDegrees??0)*Math.PI/180,c=Math.abs(Math.cos(t)),s=Math.abs(Math.sin(t));
  return {...o,width:o.width*c+o.height*s,height:o.width*s+o.height*c,ccwRotationDegrees:0};
}
// Segment intersects a closed rectangle (conservative even at corners).
function hits(a,b,o,pad){
  let lo=0,hi=1;
  for(const [axis,size] of [["x",o.width],["y",o.height]]){
    const min=o.center[axis]-size/2-pad,max=o.center[axis]+size/2+pad,d=b[axis]-a[axis];
    if(Math.abs(d)<1e-12){if(a[axis]<min||a[axis]>max)return false;continue}
    const u=(min-a[axis])/d,v=(max-a[axis])/d;
    lo=Math.max(lo,Math.min(u,v));hi=Math.min(hi,Math.max(u,v));
    if(lo>hi)return false;
  }
  return true;
}
export function topSolverInput(input){
  if(input.connections.length!==1||input.connections[0].pointsToConnect.length!==2||input.connections[0].pointsToConnect.some(p=>p.layer!=="top"))fail("requires one untouched two-terminal top net");
  const bounds={minX:input.bounds.minX+edge,maxX:input.bounds.maxX-edge,minY:input.bounds.minY+edge,maxY:input.bounds.maxY-edge};
  if(bounds.minX>=bounds.maxX||bounds.minY>=bounds.maxY)fail("board too small");
  const name=input.connections[0].name;
  const obstacles=input.obstacles.filter(o=>o.layers.includes("top")).map(rectangle);
  // Additional clearance reserve for non-net obstacles; the solver may apply its own rules.
  return structuredClone({...input,layerCount:1,bounds,obstacles:obstacles.map(o=>({...o,layers:["top"],width:o.width+(o.connectedTo.includes(name)?0:2*clearance),height:o.height+(o.connectedTo.includes(name)?0:2*clearance)}))});
}
export function validateTopResult(input,output){
  const prepared=topSolverInput(input),connection=input.connections[0], [a,b]=connection.pointsToConnect;
  const traces=output?.traces;
  if(!Array.isArray(traces)||traces.length!==1||traces[0].type!=="pcb_trace")fail("expected exactly one trace");
  let route=traces[0].route;
  if(!Array.isArray(route)||route.length<2||route.length>102||route.some(p=>p.route_type!=="wire"||p.layer!=="top"||![p.x,p.y,p.width].every(Number.isFinite)||p.width<input.minTraceWidth-eps||p.width>5))fail("unsupported route geometry or via");
  const width=route[0].width;
  if(route.some(p=>Math.abs(p.width-width)>eps))fail("variable width");
  // A solver may finish inside a pad rather than at its center. Identify the
  // terminal using its unique centered, same-net pad, never a foreign pad or
  // an arbitrary proximity tolerance. The inscribed disk also fits rotated pads.
  const owns=(terminal,p)=>{
    if(near(terminal,p))return true;
    const pads=input.obstacles.filter(o=>o.layers.includes("top")&&o.connectedTo.includes(connection.name)&&near(o.center,terminal));
    if(pads.length!==1)return false;
    const pad=pads[0];rectangle(pad); // validate original, unexpanded dimensions
    return Math.hypot(p.x-terminal.x,p.y-terminal.y)<=Math.min(pad.width,pad.height)/2-eps;
  };
  const forward=owns(a,route[0])&&owns(b,route.at(-1));
  const reverse=owns(b,route[0])&&owns(a,route.at(-1));
  if(forward===reverse)fail("terminal identity mismatch or ambiguity: "+JSON.stringify({expected:[a,b],actual:[route[0],route.at(-1)]}));
  if(reverse)route=[...route].reverse();
  // Retain off-center solver endpoints as explicit copper lead-ins, not a
  // relaxed model/serialization tolerance. Audit all newly added segments.
  const xy=p=>({x:p.x,y:p.y});
  const points=route.map(xy);
  const resolution=1e-5; // KiCad parity grid; avoid unrepresentably short lead-ins
  if(Math.hypot(points[0].x-a.x,points[0].y-a.y)<=resolution)points[0]=xy(a);else points.unshift(xy(a));
  if(Math.hypot(points.at(-1).x-b.x,points.at(-1).y-b.y)<=resolution)points[points.length-1]=xy(b);else points.push(xy(b));
  if(points.length>102)fail("too many waypoints after terminal attachment");
  const obstacles=input.obstacles.filter(o=>o.layers.includes("top")&&!o.connectedTo.includes(connection.name)).map(rectangle);
  for(const p of points)if(p.x-width/2<prepared.bounds.minX||p.x+width/2>prepared.bounds.maxX||p.y-width/2<prepared.bounds.minY||p.y+width/2>prepared.bounds.maxY)fail("board-edge clearance");
  for(let i=1;i<points.length;i++){
    if(near(points[i-1],points[i]))fail("zero-length segment");
    if(obstacles.some(o=>hits(points[i-1],points[i],o,clearance+width/2-eps)))fail("copper clearance");
  }
  return {name:connection.name,width,waypoints:points.slice(1,-1),segments:points.length-1};
}
export function solveTopCandidate(input,Solver,deadline=Date.now()+30000){
  if(Date.now()>deadline)fail("solver budget exhausted");
  const solver=new Solver(topSolverInput(input));
  let steps=0;
  while(!solver.solved&&!solver.failed){
    if(++steps>100000||Date.now()>deadline)fail("solver budget exhausted");
    solver.step();
  }
  if(solver.failed||!solver.solved)fail("solver failed: "+String(solver.error??"unknown"));
  return validateTopResult(input,solver.getOutputSimpleRouteJson());
}
export function appendCandidate(project,candidate){
  const net=project.nets.find(n=>n.name===candidate.name);
  if(!net||net.pins.length!==2||project.routes.some(r=>r.net===net.name))fail("net is not untouched");
  let i=1;while(project.routes.some(r=>r.id==="T"+i))i++;
  return {...structuredClone(project),routes:[...structuredClone(project.routes),{id:"T"+i,net:net.name,layer:"top",width:candidate.width,from:{...net.pins[0]},to:{...net.pins[1]},waypoints:structuredClone(candidate.waypoints)}]};
}

 // Route one net at a time; validated previous copper becomes foreign obstacles.
 // All-or-nothing: no source mutation or partial results on any failure.
export function solveTopCandidates(input,Solver){
  const connections=input.connections;
  if(!Array.isArray(connections)||connections.length<1||connections.length>8||
    new Set(connections.map(c=>c.name)).size!==connections.length||
    connections.some(c=>typeof c.name!=="string"||!c.name||!Array.isArray(c.pointsToConnect)||c.pointsToConnect.length!==2||c.pointsToConnect.some(p=>p.layer!=="top"||![p.x,p.y].every(Number.isFinite))))fail("requires 1–8 distinct untouched two-terminal top nets");
  const working=structuredClone(input), candidates=[], deadline=Date.now()+30000;
  for(const connection of working.connections){
    const single={...working,connections:[connection]};
    const candidate=solveTopCandidate(single,Solver,deadline);
    candidates.push(candidate);
    const points=[connection.pointsToConnect[0],...candidate.waypoints,connection.pointsToConnect[1]];
    const segments=points.slice(1).map((to,i)=>({from:points[i],to,width:candidate.width,layer:"top"}));
    // No connection exemption: every later net must avoid this copper.
    working.obstacles.push(...copperObstacles({segments,vias:[]}));
  }
  return candidates;
}

// Opt-in two-layer candidate: explicit review-only through-via profile.
const viaProfile=Object.freeze({diameter:.6,drill:.3});
export function twoLayerSolverInput(input){
  const prepared=topSolverInput(input);
  if(input.layerCount!==2)fail("requires exactly two copper layers");
  if(input.obstacles.some(o=>!Array.isArray(o.layers)||!o.layers.length||o.layers.some(l=>!["top","bottom"].includes(l))))fail("unknown obstacle layer");
  const name=input.connections[0].name;
  return structuredClone({...prepared,layerCount:2,minViaDiameter:viaProfile.diameter,
    obstacles:input.obstacles.map(rectangle).map(o=>({...o,width:o.width+(o.connectedTo.includes(name)?0:2*clearance),height:o.height+(o.connectedTo.includes(name)?0:2*clearance)}))});
}
export function validateTwoLayerResult(input,output){
  const prepared=twoLayerSolverInput(input),connection=input.connections[0],[a,b]=connection.pointsToConnect;
  if(!Array.isArray(output?.traces)||output.traces.length!==1||output.traces[0].type!=="pcb_trace")fail("expected exactly one trace");
  let route=output.traces[0].route;
  const wire=p=>p?.route_type==="wire"&&["top","bottom"].includes(p.layer)&&[p.x,p.y,p.width].every(Number.isFinite)&&p.width>=input.minTraceWidth-eps&&p.width<=5;
  const via=p=>p?.route_type==="via"&&[p.x,p.y].every(Number.isFinite)&&["top","bottom"].includes(p.from_layer)&&["top","bottom"].includes(p.to_layer)&&p.from_layer!==p.to_layer;
  // Report the actual rejected token, not just a generic error. Keep the
  // accepted route contract and all physical checks unchanged.
  if(!Array.isArray(route)||route.length<2||route.length>306)fail("unsupported two-layer geometry: route length "+(Array.isArray(route)?route.length:"not an array"));
  const describe=(p,index)=>({index,route_type:p?.route_type,layer:p?.layer,from_layer:p?.from_layer,to_layer:p?.to_layer,x:p?.x,y:p?.y,width:p?.width,via_diameter:p?.via_diameter,diameter:p?.diameter,keys:p&&typeof p==="object"?Object.keys(p):[]});
  const invalid=route.findIndex(p=>!wire(p)&&!via(p));
  if(invalid!==-1)fail("unsupported two-layer geometry: invalid token "+JSON.stringify(describe(route[invalid],invalid)));
  if(!wire(route[0])||!wire(route.at(-1))||route[0].layer!=="top"||route.at(-1).layer!=="top")fail("unsupported two-layer geometry: invalid terminals "+JSON.stringify([describe(route[0],0),describe(route.at(-1),route.length-1)]));
  const width=route[0].width;
  if(route.some(p=>wire(p)&&Math.abs(p.width-width)>eps))fail("variable width");
  const owns=(terminal,p)=>{
    if(near(terminal,p))return true;
    const pads=input.obstacles.filter(o=>o.layers.includes("top")&&o.connectedTo.includes(connection.name)&&near(o.center,terminal));
    if(pads.length!==1)return false;
    const pad=pads[0];rectangle(pad);
    return Math.hypot(p.x-terminal.x,p.y-terminal.y)<=Math.min(pad.width,pad.height)/2-eps;
  };
  const forward=owns(a,route[0])&&owns(b,route.at(-1)),reverse=owns(b,route[0])&&owns(a,route.at(-1));
  if(forward===reverse)fail("two-layer terminal identity mismatch: "+JSON.stringify({expected:[a,b],actual:[route[0],route.at(-1)]}));
  if(reverse)route=[...route].reverse().map(p=>via(p)?{...p,from_layer:p.to_layer,to_layer:p.from_layer}:p);
  let layer="top";
  const points=[],xy=p=>({x:p.x,y:p.y});
  for(let i=0;i<route.length;i++){
    const p=route[i],last=points.at(-1);
    if(wire(p)){
      if(p.layer!==layer)fail("wire layer change without via");
      if(last&&near(last,p)){
        if(!via(route[i-1]))fail("zero-length wire");
        continue;
      }
      points.push(xy(p));
    }else{
      if(!wire(route[i-1])||!wire(route[i+1])||p.from_layer!==layer||route[i+1].layer!==p.to_layer)fail("invalid via transition");
      if(width>viaProfile.diameter)fail("trace wider than review via");
      if(last&&near(last,p)){
        if(last.via)fail("duplicate via");
        Object.assign(last,xy(p),{via:{...viaProfile}});
      }else points.push({...xy(p),via:{...viaProfile}});
      layer=p.to_layer;
    }
  }
  if(layer!=="top")fail("must return to top");
  const resolution=1e-5;
  if(Math.hypot(points[0].x-a.x,points[0].y-a.y)<=resolution){
    if(points[0].via)fail("via at terminal");
    points[0]=xy(a);
  }else points.unshift(xy(a));
  if(Math.hypot(points.at(-1).x-b.x,points.at(-1).y-b.y)<=resolution){
    if(points.at(-1).via)fail("via at terminal");
    points[points.length-1]=xy(b);
  }else points.push(xy(b));
  if(points.length>102)fail("too many two-layer waypoints");
  const obstacles=input.obstacles.map(rectangle),foreign=obstacles.filter(o=>!o.connectedTo.includes(connection.name));
  const inBounds=(p,r)=>p.x-r>=prepared.bounds.minX&&p.x+r<=prepared.bounds.maxX&&p.y-r>=prepared.bounds.minY&&p.y+r<=prepared.bounds.maxY;
  const vias=[];
  layer="top";
  for(let i=0;i<points.length;i++){
    const p=points[i],prev=points[i-1];
    if(!inBounds(p,width/2))fail("board-edge clearance");
    if(prev){
      if(near(prev,p))fail("zero-length segment");
      if(foreign.some(o=>o.layers.includes(layer)&&hits(prev,p,o,clearance+width/2-eps)))fail("copper clearance on "+layer);
    }
    if(p.via){
      if(!prev||i===points.length-1||!inBounds(p,viaProfile.diameter/2))fail("via board-edge or terminal clearance");
      // No via-in-pad, including same-net SMD pads; both layers checked.
      if(obstacles.some(o=>hits(p,p,o,clearance+viaProfile.diameter/2-eps)))fail("via copper clearance");
      if(vias.some(v=>Math.hypot(v.x-p.x,v.y-p.y)<viaProfile.diameter+clearance-eps))fail("via-to-via clearance");
      vias.push(p);
      layer=layer==="top"?"bottom":"top";
    }
  }
  if(layer!=="top")fail("must return to top");
  return {name:connection.name,width,waypoints:points.slice(1,-1),segments:points.length-1,vias:vias.length};
}
export function solveTwoLayerCandidate(input,Solver,deadline=Date.now()+30000){
  if(Date.now()>deadline)fail("solver budget exhausted");
  const solver=new Solver(twoLayerSolverInput(input));
  let steps=0;
  while(!solver.solved&&!solver.failed){
    if(++steps>100000||Date.now()>deadline)fail("solver budget exhausted");
    solver.step();
  }
  if(solver.failed||!solver.solved)fail("solver failed: "+String(solver.error??"unknown"));
  return validateTwoLayerResult(input,solver.getOutputSimpleRouteJson());
}

 // Experimental two-layer batch; use the same per-net physical audit and
 // treat each previously accepted track and via as foreign copper.
export function solveTwoLayerCandidates(input,Solver){
  const connections=input.connections;
  if(input.layerCount!==2||!Array.isArray(connections)||connections.length<1||connections.length>8||
    new Set(connections.map(c=>c.name)).size!==connections.length||
    connections.some(c=>typeof c.name!=="string"||!c.name||!Array.isArray(c.pointsToConnect)||c.pointsToConnect.length!==2||c.pointsToConnect.some(p=>p.layer!=="top"||![p.x,p.y].every(Number.isFinite))))fail("requires exactly two layers and 1–8 distinct untouched two-terminal top nets");
  const working=structuredClone(input),candidates=[],deadline=Date.now()+30000;
  for(const connection of working.connections){
    const candidate=solveTwoLayerCandidate({...working,connections:[connection]},Solver,deadline);
    const points=[connection.pointsToConnect[0],...candidate.waypoints,connection.pointsToConnect[1]];
    let layer="top";
    const segments=[],vias=[];
    for(let i=1;i<points.length;i++){
      const from=points[i-1],to=points[i];
      segments.push({from,to,width:candidate.width,layer});
      if(to.via){
        vias.push({x:to.x,y:to.y,...to.via});
        layer=layer==="top"?"bottom":"top";
      }
    }
    if(layer!=="top")fail("batch route must return to top");
    working.obstacles.push(...copperObstacles({segments,vias}));
    candidates.push(candidate);
  }
  return candidates;
}
