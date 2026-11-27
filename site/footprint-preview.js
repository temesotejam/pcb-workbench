// Strict subset of exact imported Circuit JSON: two rectangular or circular top SMD pads.
 // Unsupported or ambiguous data must never become fabricated pad geometry.
export function normalizeFootprint(elements){
  if(!Array.isArray(elements))throw new Error("Invalid footprint elements");
  const physical=elements.filter(e=>e.type==="pcb_smtpad"||e.type==="pcb_plated_hole"||e.type==="pcb_hole");
  if(physical.length!==2||physical.some(e=>e.type!=="pcb_smtpad"||e.layer!=="top"))throw new Error("Unsupported footprint pad count or layer");
  const pads=physical.map(e=>{
    const pins=[...new Set((Array.isArray(e.port_hints)?e.port_hints:[]).map(h=>String(h).match(/^(?:pin)?([12])$/i)?.[1]).filter(Boolean))];
    if(pins.length!==1||!Number.isFinite(e.x)||!Number.isFinite(e.y))throw new Error("Ambiguous pad identity or position");
    const p={pin:pins[0],x:e.x,y:e.y,shape:e.shape,rotation:0};
    if(e.shape==="rect"||e.shape==="rotated_rect"){
      if(!Number.isFinite(e.width)||e.width<=0||!Number.isFinite(e.height)||e.height<=0)throw new Error("Invalid rectangular pad dimensions");
      if(e.shape==="rotated_rect"){
        if(!Number.isFinite(e.ccw_rotation))throw new Error("Missing pad rotation");
        p.rotation=e.ccw_rotation;
      }
      return {...p,width:e.width,height:e.height};
    }
    if(e.shape==="circle"&&Number.isFinite(e.radius)&&e.radius>0)return {...p,radius:e.radius};
    throw new Error("Unsupported pad shape: "+e.shape);
  });
  if(new Set(pads.map(p=>p.pin)).size!==2)throw new Error("Duplicate pad pin");
  return pads.sort((a,b)=>a.pin.localeCompare(b.pin));
}
export function padPoint(position,pad){
  const a=position.rotation*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
  const clean=n=>Math.abs(n)<1e-12?0:n;
  return {x:clean(position.x+pad.x*c-pad.y*s),y:clean(-(position.y+pad.x*s+pad.y*c))};
}
// No center-based fallback: absence of a verified geometry is visibly incomplete.
export function pcbPadLinks(project,footprints){
  const byRef=new Map(project.components.map(c=>[c.ref,c]));
  const links=[];
  for(const net of project.nets){
    const endpoints=net.pins.map(p=>{
      const component=byRef.get(p.ref),pad=footprints?.parts?.[component?.lcsc]?.pads?.find(q=>q.pin===p.pin);
      return pad?{...p,pad}:null;
    });
    if(endpoints.some(p=>!p))continue;
    for(let i=1;i<endpoints.length;i++)links.push({name:net.name,from:endpoints[0],to:endpoints[i]});
  }
  return links;
}
