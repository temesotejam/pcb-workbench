import {padPoint} from "./footprint-preview.js";

// Coordinates are model millimetres, with positive Y up. No inferred pads.
export function routePoints(project,footprints,route){
  function endpoint(pin){
    const c=project.components.find(c=>c.ref===pin.ref);
    const pad=footprints?.parts?.[c?.lcsc]?.pads?.find(p=>p.pin===pin.pin);
    if(!c||!pad||!Number.isFinite(pad.x)||!Number.isFinite(pad.y))throw new Error("Exact pad unavailable: "+pin.ref+":"+pin.pin);
    const p=padPoint(c.pcb,pad);
    return {x:p.x,y:-p.y};
  }
  const points=[endpoint(route.from),...route.waypoints,endpoint(route.to)];
  for(let i=0;i<points.length;i++){
    const p=points[i],prev=points[i-1];
    if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)+route.width/2>project.board.width/2+1e-9||Math.abs(p.y)+route.width/2>project.board.height/2+1e-9)throw new Error("Route centerline or width outside board");
    if(prev&&Math.hypot(p.x-prev.x,p.y-prev.y)<1e-9)throw new Error("Zero-length route segment");
  }
  return points;
}

export function parseWaypoints(value){
  if(!value.trim())return [];
  return value.trim().split(/\n/).map(line=>{
    const fields=line.trim().split(/\s*,\s*/);
    if(fields.length!==2||fields.some(s=>!s.trim()||!Number.isFinite(Number(s))))throw new Error("Waypoint format: x,y in mm, one per line");
    return {x:Number(fields[0]),y:Number(fields[1])};
  });
}
