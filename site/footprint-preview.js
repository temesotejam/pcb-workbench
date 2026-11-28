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
// Only routes successfully rendered by the caller count as draft connectivity.
// This is graph bookkeeping, NOT physical clearance/short/continuity verification.
export function pcbPadLinks(project,footprints,renderedRoutes=[]){
  const byRef=new Map(project.components.map(c=>[c.ref,c]));
  const links=[];
  const key=p=>p.ref+":"+p.pin;
  const byNet=new Map();
  for(const route of renderedRoutes){
    if(!byNet.has(route.net))byNet.set(route.net,[]);
    byNet.get(route.net).push(route);
  }
  for(const net of project.nets){
    const endpoints=net.pins.map(p=>{
      const component=byRef.get(p.ref),pad=footprints?.parts?.[component?.lcsc]?.pads?.find(q=>q.pin===p.pin);
      return pad?{...p,pad}:null;
    });
    if(endpoints.some(p=>!p))continue;
    if(endpoints.length<2)continue;
    const parent=new Map(endpoints.map(p=>[key(p),key(p)]));
    const find=id=>{
      let root=id;
      while(parent.get(root)!==root)root=parent.get(root);
      while(id!==root){const next=parent.get(id);parent.set(id,root);id=next}
      return root;
    };
    for(const route of byNet.get(net.name)??[]){
      const a=key(route.from),b=key(route.to);
      if(parent.has(a)&&parent.has(b))parent.set(find(b),find(a));
    }
    // Draw one link between each distinct routed group, retaining the stable
    // net pin order. Avoid implying that an unrenderable route is connected.
    const groups=new Map();
    for(const endpoint of endpoints){
      const root=find(key(endpoint));
      if(!groups.has(root))groups.set(root,endpoint);
    }
    const reps=[...groups.values()];
    for(let i=1;i<reps.length;i++)links.push({name:net.name,from:reps[0],to:reps[i]});
  }
  return links;
}
