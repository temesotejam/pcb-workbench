import {validateProject,inspectProject} from "../site/project-model.js";

// Whitelist the fields consumed by the renderer; never execute imported text.
export function projectToCircuitPlan(project,catalog){
  validateProject(project,catalog);
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
