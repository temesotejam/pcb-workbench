import {validateProject,inspectProject} from "../site/project-model.js";

// Whitelist the fields consumed by the renderer; never execute imported text.
export function projectToCircuitPlan(project,catalog){
  validateProject(project,catalog);
  if(project.routes?.length)throw new Error("Manual PCB routes cannot yet be exported; refusing to substitute autorouting");
  const issues=inspectProject(project,catalog).issues;
  if(issues.length)throw new Error("Logical design incomplete: "+issues.join("; "));
  return {
    name:project.name,
    board:{width:project.board.width,height:project.board.height},
    parts:project.components.map(c=>({ref:c.ref,lcsc:c.lcsc,rotationOffset:null,reviewed:false})),
    placements:project.components.map(c=>({name:c.ref,lcsc:c.lcsc,pcbX:c.pcb.x,pcbY:c.pcb.y,pcbRotation:c.pcb.rotation,schX:c.schematic.x,schY:c.schematic.y,schRotation:c.schematic.rotation})),
    nets:project.nets.map(n=>n.name),
    traces:project.nets.flatMap(n=>n.pins.map(pin=>({from:"."+pin.ref+" > .pin"+pin.pin,to:"net."+n.name}))),
    orderReady:false
  };
}
export function planMetadata(plan,id){
  return {id,name:plan.name,revision:"schema-v1",purpose:"Independent JSON design; unreviewed preview",release:false,assemblyProfile:"Candidate only",layers:["F.Cu","B.Cu","F.Paste","B.Paste","F.Mask","B.Mask","F.SilkS","B.SilkS","Edge.Cuts"],parts:plan.parts,expectedNets:plan.nets,allowedWarnings:[]};
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
