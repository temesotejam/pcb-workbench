function modelToSvg(p){return {x:p.x,y:-p.y}}

function moveFromDrag(position,start,end,step=.5){
  const snap=n=>Math.max(-10000,Math.min(10000,Math.round(n/step)*step))||0;
  return {x:snap(position.x+end.x-start.x),y:snap(position.y-end.y+start.y),rotation:position.rotation};
}

function fitView(project,view){
  const xs=[-10,10],ys=[-8,8];
  if(view==="pcb"){xs.push(-project.board.width/2,project.board.width/2);ys.push(-project.board.height/2,project.board.height/2)}
  for(const c of project.components){const p=modelToSvg(c[view]);xs.push(p.x);ys.push(p.y)}
  const margin=view==="schematic"?10:4;
  const x=Math.min(...xs)-margin,y=Math.min(...ys)-margin;
  return [x,y,Math.max(...xs)+margin-x,Math.max(...ys)+margin-y];
}

function logicalLinks(project){
  const refs=new Set(project.components.map(c=>c.ref)),links=[];
  for(const net of project.nets){
    const connected=[...new Set(net.pins.map(p=>p.ref))].filter(ref=>refs.has(ref));
    for(let i=1;i<connected.length;i++)links.push({name:net.name,from:connected[0],to:connected[i]});
  }
  return links;
}
// Schematic symbol anchors only; never use as physical PCB pad coordinates.
function schematicPinPoint(position,pin){
  if(!["1","2"].includes(pin))throw new Error("Unknown schematic pin");
  const dx=pin==="1"?-3:3;
  const offsets={0:[dx,0],90:[0,dx],180:[-dx,0],270:[0,-dx]};
  const offset=offsets[position.rotation];
  if(!offset)throw new Error("Invalid schematic rotation");
  return modelToSvg({x:position.x+offset[0],y:position.y+offset[1]});
}
function schematicLinks(project){
  const refs=new Set(project.components.map(c=>c.ref)),links=[];
  for(const net of project.nets){
    const pins=net.pins.filter(p=>refs.has(p.ref));
    for(let i=1;i<pins.length;i++)links.push({name:net.name,from:pins[0],to:pins[i]});
  }
  return links;
}
export {modelToSvg,moveFromDrag,fitView,logicalLinks,schematicPinPoint,schematicLinks};
