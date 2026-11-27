import {modelToSvg,moveFromDrag,fitView,logicalLinks,schematicPinPoint,schematicLinks} from "./editor-geometry.js";
const NS="http://www.w3.org/2000/svg";
function node(tag,attrs,parent,content){
  const e=document.createElementNS(NS,tag);
  for(const [key,value] of Object.entries(attrs))e.setAttribute(key,String(value));
  if(content!==undefined)e.textContent=content;
  if(parent)parent.append(e);
  return e;
}
function label(parent,x,y,text,size=1.4,anchor="middle"){
  return node("text",{x,y,"font-size":size,"text-anchor":anchor,fill:"currentColor","pointer-events":"none"},parent,text);
}
function transform(p){const {x,y}=modelToSvg(p);return "translate("+x+" "+y+")"}
function short(s){return s.length>14?s.slice(0,13)+"…":s}
function drawComponent(parent,c,p,view,netNames){
  const pos=c[view],g=node("g",{transform:transform(pos),"data-ref":c.ref,tabindex:0,role:"button","aria-label":c.ref+" "+p.value+" "+view+" placement"},parent);
  node("title",{},g,c.ref+" / "+p.lcsc+" / "+p.value);
  const body=node("g",{transform:"rotate("+(-pos.rotation)+")"},g);
  if(view==="schematic"){
    node("rect",{x:-3.5,y:-2,width:7,height:4,fill:"transparent"},body);
    node("path",{d:"M -3 0 H -1.5 M 1.5 0 H 3",stroke:"currentColor","stroke-width":.18,fill:"none"},body);
    if(p.kind==="resistor")node("rect",{x:-1.5,y:-.65,width:3,height:1.3,fill:"#19232e",stroke:"currentColor","stroke-width":.18},body);
    else node("path",{d:"M -1.5 0 H -.35 M .35 0 H 1.5 M -.35 -1.1 V 1.1 M .35 -1.1 V 1.1",stroke:"currentColor","stroke-width":.2,fill:"none"},body);
    // Logical pin labels, not a physical wire representation.
    for(const [i,x] of [[1,-3],[2,3]]){
      const hit=node("circle",{cx:x,cy:0,r:.6,fill:"#61d1b3",stroke:"#16332e","stroke-width":.12,"data-pin":String(i),tabindex:0,role:"button","aria-label":c.ref+" pin "+i+" "+netNames[i-1]},body);
      node("title",{},hit,c.ref+":"+i+" / "+netNames[i-1]);
      const pin=label(body,x,-.65,String(i),.95);
      pin.setAttribute("transform","rotate("+pos.rotation+" "+x+" -.65)");
    }
    label(g,0,-3.7,c.ref+" "+p.value);
    label(g,0,4.2,"1:"+short(netNames[0])+" / 2:"+short(netNames[1]),1.05);
  }else{
    // Nominal body dimensions only: no fabricated pad geometry.
    const [w,h]=p.package==="0805"?[2,1.25]:[1.6,.8];
    node("rect",{x:-w/2,y:-h/2,width:w,height:h,rx:.12,fill:"#315a55",stroke:"#9be4d0","stroke-width":.12},body);
    node("path",{d:"M 0 0 H "+w/2,stroke:"#9be4d0","stroke-width":.12},body);
    node("circle",{cx:0,cy:0,r:.12,fill:"#f0c780"},body);
    label(g,0,-1.8,c.ref,1.05);
  }
  return g;
}
export function attachGraphicEditor(svg,view,onEdit,onStatus=()=>{}){
  let project,drag=null,selected=null;
  function clearPin(){
    if(selected)selected.element.removeAttribute("data-selected");
    selected=null;
  }
  function choosePin(element){
    const pin={ref:element.closest("[data-ref]").dataset.ref,pin:element.dataset.pin};
    if(!selected){
      selected={pin,element};element.setAttribute("data-selected","true");
      onStatus(pin.ref+":"+pin.pin+" を選択。接続先のピンを選んでください（Escで解除）");
      return;
    }
    const from=selected.pin;clearPin();
    if(from.ref===pin.ref&&from.pin===pin.pin){onStatus("ピン選択を解除しました");return}
    onEdit({type:"connect-pins",from,to:pin});
  }
  const groups=new Map(),edges=[];
  function redrawLinks(ref,pos){
    for(const edge of edges){
      for(const [endpoint,suffix] of [[edge.from,"1"],[edge.to,"2"]]){
        if((view==="schematic"?endpoint.ref:endpoint)!==ref)continue;
        const p=view==="schematic"?schematicPinPoint(pos,endpoint.pin):modelToSvg(pos);
        edge.line.setAttribute("x"+suffix,p.x);edge.line.setAttribute("y"+suffix,p.y);
      }
    }
  }
  function point(e){
    const m=svg.getScreenCTM();
    if(!m)return null;
    const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(m.inverse());
    return Number.isFinite(p.x)&&Number.isFinite(p.y)?p:null;
  }
  function group(e){const g=e.target.closest?.("[data-ref]");return g&&svg.contains(g)?g:null}
  function preview(d,pos){
    groups.get(d.ref)?.setAttribute("transform",transform(pos));
    redrawLinks(d.ref,pos);
  }
  function cancel(){if(!drag)return;const d=drag;drag=null;preview(d,d.position)}
  svg.addEventListener("pointerdown",e=>{
    if(drag||e.button!==0||!project)return;
    if(view==="schematic"&&e.target.closest?.("[data-pin]"))return;
    clearPin();
    const g=group(e),p=point(e);if(!g||!p)return;
    const c=project.components.find(c=>c.ref===g.dataset.ref);if(!c)return;
    e.preventDefault();g.focus();svg.setPointerCapture(e.pointerId);
    drag={ref:c.ref,id:e.pointerId,position:c[view],start:p,moved:false};
  });
  svg.addEventListener("pointermove",e=>{
    if(!drag||drag.id!==e.pointerId)return;
    const p=point(e);if(!p)return;
    if(Math.hypot(p.x-drag.start.x,p.y-drag.start.y)<.1&&!drag.moved)return;
    drag.moved=true;preview(drag,moveFromDrag(drag.position,drag.start,p));
  });
  svg.addEventListener("pointerup",e=>{
    if(!drag||drag.id!==e.pointerId)return;
    const d=drag,p=point(e);drag=null;
    preview(d,d.position);
    if(d.moved&&p){const pos=moveFromDrag(d.position,d.start,p);onEdit({type:"place",ref:d.ref,view,...pos});groups.get(d.ref)?.focus()}
  });
  svg.addEventListener("pointercancel",cancel);
  svg.addEventListener("lostpointercapture",cancel);
  svg.addEventListener("click",e=>{
    const pin=e.target.closest?.("[data-pin]");
    if(view==="schematic"&&pin&&svg.contains(pin)&&!drag){choosePin(pin);e.stopPropagation()}
  });
  svg.addEventListener("keydown",e=>{
    if(e.key==="Escape"&&selected){clearPin();onStatus("ピン選択を解除しました");return}
    if(e.key==="Escape"&&drag){cancel();return}
    const pin=e.target.closest?.("[data-pin]");
    if(pin){
      if(e.key==="Enter"||e.key===" "){e.preventDefault();choosePin(pin)}
      return;
    }
    const g=group(e);if(!g||drag)return;
    const c=project.components.find(c=>c.ref===g.dataset.ref);if(!c)return;
    let {x,y,rotation}=c[view],step=e.shiftKey?2:.5;
    switch(e.key){
      case "ArrowLeft":x-=step;break;case "ArrowRight":x+=step;break;
      case "ArrowUp":y+=step;break;case "ArrowDown":y-=step;break;
      case "r":case "R":rotation=(rotation+90)%360;break;
      default:return;
    }
    e.preventDefault();
    x=Math.max(-10000,Math.min(10000,x));y=Math.max(-10000,Math.min(10000,y));
    onEdit({type:"place",ref:c.ref,view,x,y,rotation});groups.get(c.ref)?.focus();
  });
  return function render(next,catalog){
    cancel();clearPin();project=next;svg.replaceChildren();groups.clear();edges.length=0;
    svg.setAttribute("viewBox",fitView(project,view).join(" "));
    if(view==="pcb"){
      const {width,height}=project.board;
      node("rect",{x:-width/2,y:-height/2,width,height,fill:"#16332e",stroke:"#61d1b3","stroke-width":.16},svg);
      const byRef=new Map(project.components.map(c=>[c.ref,c]));
      for(const link of logicalLinks(project)){
        const a=modelToSvg(byRef.get(link.from).pcb),b=modelToSvg(byRef.get(link.to).pcb);
        const line=node("line",{x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:"#f0c780","stroke-width":.12,"stroke-dasharray":".45 .3","pointer-events":"none"},svg);
        edges.push({...link,line});
      }
    }
    if(view==="schematic"){
      const byRef=new Map(project.components.map(c=>[c.ref,c]));
      for(const link of schematicLinks(project)){
        const a=schematicPinPoint(byRef.get(link.from.ref).schematic,link.from.pin);
        const b=schematicPinPoint(byRef.get(link.to.ref).schematic,link.to.pin);
        const line=node("line",{x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:"#61d1b3","stroke-width":.16,"stroke-dasharray":".5 .3","pointer-events":"none"},svg);
        node("title",{},line,link.name);edges.push({...link,line});
      }
    }
    const [x,y,w,h]=fitView(project,view);
    node("path",{d:"M "+x+" 0 H "+(x+w)+" M 0 "+y+" V "+(y+h),stroke:"#708090","stroke-width":.08,"stroke-dasharray":".5 .5","pointer-events":"none"},svg);
    const partById=new Map(catalog.parts.map(p=>[p.lcsc,p]));
    const netByPin=new Map(project.nets.flatMap(n=>n.pins.map(p=>[p.ref+":"+p.pin,n.name])));
    for(const c of project.components){
      const names=["1","2"].map(pin=>netByPin.get(c.ref+":"+pin)??"NC");
      groups.set(c.ref,drawComponent(svg,c,partById.get(c.lcsc),view,names));
    }
  }
}
