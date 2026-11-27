import {padPoint} from "./footprint-preview.js";

// Coordinates are model millimetres, with positive Y up. No inferred pads.
export function routeEndpoint(project,footprints,pin){
  const c=project.components.find(c=>c.ref===pin.ref);
  const pad=footprints?.parts?.[c?.lcsc]?.pads?.find(p=>p.pin===pin.pin);
  if(!c||!pad||!Number.isFinite(pad.x)||!Number.isFinite(pad.y))throw new Error("Exact pad unavailable: "+pin.ref+":"+pin.pin);
  const p=padPoint(c.pcb,pad);
  return {x:p.x,y:-p.y};
}
function checkPoint(project,p,width){
  if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)+width/2>project.board.width/2+1e-9||Math.abs(p.y)+width/2>project.board.height/2+1e-9)throw new Error("Route centerline or width outside board");
}
const samePin=(a,b)=>a.ref===b.ref&&a.pin===b.pin;
const samePoint=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)<1e-9;
export function routePoints(project,footprints,route){
  const points=[routeEndpoint(project,footprints,route.from),...route.waypoints,routeEndpoint(project,footprints,route.to)];
  for(let i=0;i<points.length;i++){
    const p=points[i],prev=points[i-1];
    checkPoint(project,p,route.width);
    if(prev&&samePoint(p,prev))throw new Error("Zero-length route segment");
  }
  return points;
}

function checkVia(project,point,v,width){
  if(!v||!Number.isFinite(v.diameter)||!Number.isFinite(v.drill)||v.drill<.1||v.diameter>5||v.diameter<width||v.diameter-v.drill<.1-1e-9)throw new Error("Invalid through-via");
  checkPoint(project,point,v.diameter);
}
function copperPath(points,width){
  const segments=[],vias=[];
  let layer="top";
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];
    if(!samePoint(a,b))segments.push({from:{x:a.x,y:a.y},to:{x:b.x,y:b.y},layer,width});
    if(b.via!==undefined){
      const v=b.via;
      vias.push({x:b.x,y:b.y,diameter:v.diameter,drill:v.drill});
      layer=layer==="top"?"bottom":"top";
    }
  }
  return {segments,vias,layer};
}

// Each marked waypoint is a through-via; top SMD endpoints always start/end on top.
export function routeCopper(project,footprints,route){
  const points=routePoints(project,footprints,route);
  for(const p of points)if(p.via!==undefined)checkVia(project,p,p.via,route.width);
  const {segments,vias,layer}=copperPath(points,route.width);
  if(layer!=="top")throw new Error("Top SMD endpoints require an even number of layer transitions");
  return {segments,vias};
}

// A partial draft may end on bottom; the cursor is not a committed via.
export function routeDraftCopper(draft,cursor){
  return copperPath([draft.start,...draft.waypoints,...(cursor?[{x:cursor.x,y:cursor.y}]:[])],draft.width);
}

export function parseWaypoints(value){
  if(!value.trim())return [];
  return value.trim().split(/\n/).map(line=>{
    const fields=line.trim().split(/\s*,\s*/);
    if(![2,4].includes(fields.length)||fields.some(s=>!s.trim()||!Number.isFinite(Number(s))))throw new Error("Waypoint format: x,y or x,y,viaDiameter,viaDrill in mm, one per line");
    const [x,y,diameter,drill]=fields.map(Number);
    return {x,y,...(fields.length===4?{via:{diameter,drill}}:{})};
  });
}

 // A graphical draft is ephemeral; only its finished edit may enter the model.
export function beginRouteDraft(project,footprints,from,width){
  if(!Number.isFinite(width)||width<.05||width>5)throw new Error("Invalid route width");
  const net=project.nets.find(n=>n.pins.some(p=>samePin(p,from)));
  if(!net)throw new Error("Pad is not assigned to a logical net");
  const start=routeEndpoint(project,footprints,from);
  checkPoint(project,start,width);
  return {from:{ref:from.ref,pin:from.pin},net:net.name,width,start,waypoints:[]};
}
export function snapRoutePoint(svgPoint,step=.25){
  if(!Number.isFinite(svgPoint.x)||!Number.isFinite(svgPoint.y)||!Number.isFinite(step)||step<=0)throw new Error("Invalid route coordinate");
  const snap=n=>Math.round(n/step)*step||0;
  return {x:snap(svgPoint.x),y:snap(-svgPoint.y)};
}
export function appendRouteWaypoint(project,draft,svgPoint,via=undefined){
  const point=snapRoutePoint(svgPoint);
  checkPoint(project,point,draft.width);
  if(via!==undefined){
    checkVia(project,point,via,draft.width);
    point.via={diameter:via.diameter,drill:via.drill};
  }
  if(samePoint(point,draft.waypoints.at(-1)??draft.start))throw new Error("Repeated route waypoint");
  if(draft.waypoints.length>=100)throw new Error("Too many route waypoints");
  return {...draft,waypoints:[...draft.waypoints,point]};
}
export function finishRouteDraft(project,footprints,draft,to){
  const net=project.nets.find(n=>n.name===draft.net);
  if(!net||!net.pins.some(p=>samePin(p,draft.from))||!net.pins.some(p=>samePin(p,to)))throw new Error("Route pads must be on the same logical net");
  if(samePin(draft.from,to))throw new Error("Route needs two different pads");
  const edit={type:"add-route",from:draft.from,to:{ref:to.ref,pin:to.pin},width:draft.width,waypoints:draft.waypoints};
  routeCopper(project,footprints,edit);
  return edit;
}
