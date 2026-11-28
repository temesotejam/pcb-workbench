import {routeCopper} from "./route-geometry.js";

// Advisory geometry only: capsule tracks and disks for via outer copper.
// Never replace independent KiCad ERC/DRC or infer pad connectivity.
export function scanCopperClearance(items,clearance=.2,{maxComparisons=150000,maxItems=5000,maxFindings=100}={}){
  if(!Number.isFinite(clearance)||clearance<0||clearance>5)throw new Error("Invalid draft clearance");
  const result={findings:[],checkedPairs:0,totalFindings:0,complete:true,clearance,orderReady:false};
  if(items.length>maxItems)return {...result,complete:false,reason:"primitive limit"};
  const finitePoint=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y);
  const dist=(p,a,b)=>{
    const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy;
    const t=l?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l)):0;
    return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
  };
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const opposite=(a,b)=>(a>0&&b<0)||(a<0&&b>0);
  const separation=(a,b,c,d)=>{
    // A proper interior intersection has zero centerline distance. Endpoint
    // and collinear cases (including zero-length via disks) use projections.
    if(opposite(cross(a,b,c),cross(a,b,d))&&opposite(cross(c,d,a),cross(c,d,b)))return 0;
    return Math.min(dist(a,c,d),dist(b,c,d),dist(c,a,b),dist(d,a,b));
  };
  const shapes=items.map(s=>{
    if(!finitePoint(s.a)||!finitePoint(s.b)||!Number.isFinite(s.radius)||s.radius<=0||!["top","bottom"].includes(s.layer)||typeof s.net!=="string"||!s.net)throw new Error("Invalid draft copper primitive");
    return {...s,minX:Math.min(s.a.x,s.b.x)-s.radius,maxX:Math.max(s.a.x,s.b.x)+s.radius,minY:Math.min(s.a.y,s.b.y)-s.radius,maxY:Math.max(s.a.y,s.b.y)+s.radius};
  }).sort((a,b)=>a.minX-b.minX);
  const eps=1e-9;
  for(let i=0;i<shapes.length;i++){
    const a=shapes[i];
    for(let j=i+1;j<shapes.length;j++){
      const b=shapes[j];
      if(b.minX>a.maxX+clearance+eps)break;
      if(result.checkedPairs>=maxComparisons)return {...result,complete:false,reason:"comparison limit"};
      result.checkedPairs++;
      if(a.layer!==b.layer||a.net===b.net||b.minY>a.maxY+clearance+eps||a.minY>b.maxY+clearance+eps)continue;
      const gap=separation(a.a,a.b,b.a,b.b)-a.radius-b.radius;
      if(gap>eps&&gap+eps>=clearance)continue;
      result.totalFindings++;
      if(result.findings.length<maxFindings)result.findings.push({a:a.id,b:b.id,netA:a.net,netB:b.net,layer:a.layer,gapMm:gap,kind:gap<=eps?"overlap":"clearance"});
    }
  }
  return result;
}

export function inspectDraftClearance(project,footprints,clearance=.2){
  const items=[],unavailable=[];
  for(const route of project.routes??[]){
    let copper;
    try{copper=routeCopper(project,footprints,route)}catch(e){unavailable.push({id:route.id,message:e.message});continue}
    for(const [i,s] of copper.segments.entries())items.push({id:route.id+":S"+(i+1),net:route.net,layer:s.layer,a:s.from,b:s.to,radius:s.width/2});
    for(const [i,v] of copper.vias.entries())for(const layer of ["top","bottom"])items.push({id:route.id+":V"+(i+1),net:route.net,layer,a:v,b:v,radius:v.diameter/2});
    if(items.length>5000)break;
  }
  const result=scanCopperClearance(items,clearance);
  return {...result,complete:result.complete&&!unavailable.length,unavailable,scope:"different-net manual track and via copper only; excludes pads, board rules, holes and connectivity"};
}
