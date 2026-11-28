import {validateProject,inspectProject} from "../site/project-model.js";
import {splitManualProject} from "./mixed-route-export.js";

// Limit initial multi-zone support to separated rectangles. KiCad retains
// responsibility for actual copper clearance, connectivity and fill.
export function validateZoneSeparation(zones){
  if(zones.length>16)throw new Error("Zone fill supports at most 16 rectangles");
  for(let i=0;i<zones.length;i++)for(let j=0;j<i;j++){
    const a=zones[i],b=zones[j];
    if(a.layer!==b.layer)continue;
    const dx=Math.max(0,a.bounds.xMin-b.bounds.xMax,b.bounds.xMin-a.bounds.xMax);
    const dy=Math.max(0,a.bounds.yMin-b.bounds.yMax,b.bounds.yMin-a.bounds.yMax);
    // Allow rounding at the six-decimal KiCad coordinate boundary only.
    if(Math.hypot(dx,dy)+1e-6<Math.max(a.clearance,b.clearance))
      throw new Error("Same-layer zones overlap or lack outline separation: "+a.id+" / "+b.id);
  }
}

// Whitelist the fields consumed by the renderer; never execute imported text.
export function projectToCircuitPlan(project,catalog,{allowManual=false,allowZones=false}={}){
  validateProject(project,catalog);
  if(project.zones?.length&&!allowZones)throw new Error("Copper zones cannot yet be exported; refusing to omit unfilled zones");
  if(project.routes?.length&&!allowManual)throw new Error("Manual PCB routes cannot yet be exported; refusing to substitute autorouting");
  const zones=project.zones?.length?structuredClone(project.zones):null;
  if(zones){
    validateZoneSeparation(zones);
    // Routing is still complete without zone copper; only the independent KiCad stage may fill it.
    project={...project,zones:[]};
  }
  const issues=inspectProject(project.routes?.length?{...project,routes:[]}:project,catalog).issues;
  if(issues.length)throw new Error("Logical design incomplete: "+issues.join("; "));
  return {
    name:project.name,
    board:{width:project.board.width,height:project.board.height},
    parts:project.components.map(c=>({ref:c.ref,lcsc:c.lcsc,rotationOffset:null,reviewed:false})),
    placements:project.components.map(c=>({name:c.ref,lcsc:c.lcsc,pcbX:c.pcb.x,pcbY:c.pcb.y,pcbRotation:c.pcb.rotation,schX:c.schematic.x,schY:c.schematic.y,schRotation:c.schematic.rotation})),
    nets:project.nets.map(n=>n.name),
    traces:project.nets.flatMap(n=>n.pins.map(pin=>({from:"."+pin.ref+" > .pin"+pin.pin,to:"net."+n.name}))),
    ...(project.routes?.length?{manualProject:structuredClone(project),mixedRouting:splitManualProject(project).automaticNets.length>0}:{}),
    ...(zones?{zones}:{}),
    orderReady:false
  };
}
export function planMetadata(plan,id){
  return {id,name:plan.name,revision:"schema-v1",purpose:"Independent JSON design; unreviewed preview",release:false,assemblyProfile:"Candidate only",layers:["F.Cu","B.Cu","F.Paste","B.Paste","F.Mask","B.Mask","F.SilkS","B.SilkS","Edge.Cuts"],parts:plan.parts,expectedNets:plan.nets,allowedWarnings:[],...(plan.zones?{expectedZones:plan.zones}:{})};
}

// Schema v1 names are logical local nets, not implicit power declarations.
// The renderer may recognize GND/VCC/etc and synthesize power symbols.
// Use collision-free neutral engine names, then restore exact user names
// after conversion. Never invent a power source or suppress ERC.
export function neutralEnginePlan(plan){
  let prefix="PCBWB_INTERNAL_NET_";
  while(plan.nets.some(name=>name.startsWith(prefix)))prefix+="_";
  const aliases=new Map(plan.nets.map((name,i)=>[prefix+(i+1),name]));
  const byName=new Map([...aliases].map(([alias,name])=>[name,alias]));
  return {
    aliases,
    plan:{...plan,nets:[...aliases.keys()],traces:plan.traces.map(t=>{
      const alias=byName.get(t.to.slice(4));
      if(!t.to.startsWith("net.")||!alias)throw new Error("Unknown logical net selector: "+t.to);
      return {...t,to:"net."+alias};
    })}
  };
}
export function restoreEngineNetNames(text,aliases){
  if(!aliases.size)return text;
  // All aliases consist of ASCII letters, underscores and digits.
  const pattern=new RegExp("\\b(?:"+[...aliases.keys()].join("|")+")\\b","g");
  return text.replace(pattern,alias=>aliases.get(alias));
}

// One policy controls both engine rendering and subsequent copper injection.
export function nativeRoutingPolicy(plan, privateOutput, env){
  const manual=Boolean(plan?.manualProject);
  const mixed=manual&&Boolean(plan.mixedRouting);
  const obstacleMode=(env.PCBWB_OBSTACLE_ROUTER==="1"||privateOutput)&&mixed;
  const twoLayerMode=privateOutput?obstacleMode:env.PCBWB_OBSTACLE_TWO_LAYER==="1";
  if(twoLayerMode&&!obstacleMode)throw new Error("Two-layer obstacle mode requires opt-in mixed routing");
  const retryReverse=privateOutput?twoLayerMode:env.PCBWB_OBSTACLE_REVERSE_RETRY==="1";
  if(retryReverse&&!twoLayerMode)throw new Error("Reverse retry requires opt-in two-layer routing");
  return {routingDisabled:manual&&(!mixed||obstacleMode),obstacleMode,twoLayerMode,retryReverse};
}
