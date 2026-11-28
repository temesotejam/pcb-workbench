// Conservative draft adapter for the pinned MIT capacity-autorouter.
 // Only one untouched two-terminal top net, constant width, no automatic vias.
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
export function solveTopCandidate(input,Solver){
  const solver=new Solver(topSolverInput(input));
  const deadline=Date.now()+30000;
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
