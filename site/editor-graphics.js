import {modelToSvg,moveFromDrag,fitView,logicalLinks,schematicPinPoint,schematicLinks} from "./editor-geometry.js";
import {padPoint,pcbPadLinks} from "./footprint-preview.js";
import {routeCopper,beginRouteDraft,appendRouteWaypoint,finishRouteDraft,snapRoutePoint,routeDraftCopper} from "./route-geometry.js";
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
function drawComponent(parent,c,p,view,netNames,footprint){
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
    for(const pad of footprint?.pads??[]){
      const attrs={fill:"#d3a552",stroke:"#ffe0a0","stroke-width":.06,"data-pad":pad.pin,tabindex:0,role:"button","aria-label":c.ref+" pad "+pad.pin+" "+netNames[Number(pad.pin)-1]};
      const shape=pad.shape==="circle"?node("circle",{...attrs,cx:pad.x,cy:-pad.y,r:pad.radius},body):
        node("rect",{...attrs,x:pad.x-pad.width/2,y:-pad.y-pad.height/2,width:pad.width,height:pad.height,transform:"rotate("+(-pad.rotation)+" "+pad.x+" "+(-pad.y)+")"},body);
      node("title",{},shape,c.ref+":"+pad.pin+" / "+netNames[Number(pad.pin)-1]);
      const pin=label(body,pad.x,-pad.y+.2,pad.pin,.55);
      pin.setAttribute("transform","rotate("+pos.rotation+" "+pad.x+" "+(-pad.y+.2)+")");
    }
    label(g,0,-1.8,c.ref+(footprint?.pads?.length===2?"":" ?pad"),1.05);
  }
  return g;
}
export function attachGraphicEditor(svg,view,onEdit,onStatus=()=>{},routing=null){
  let project,footprintData,drag=null,selected=null,draft=null,overlay=null;
  const routeMode=()=>view==="pcb"&&Boolean(routing?.enabled());
  function clearDraft(){
    draft=null;overlay?.remove();overlay=null;
    routing?.clearVia?.();
  }
  function drawDraft(cursor){
    overlay?.remove();overlay=null;
    if(!draft)return;
    overlay=node("g",{"pointer-events":"none","data-route-draft":"true"},svg);
    const copper=routeDraftCopper(draft,cursor);
    for(const s of copper.segments){
      const a=modelToSvg(s.from),b=modelToSvg(s.to);
      node("line",{x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:s.layer==="top"?"#ffd166":"#75a7f5","stroke-width":s.width,"stroke-dasharray":".5 .25","stroke-linecap":"round"},overlay);
    }
    for(const p of [draft.start,...draft.waypoints].filter(p=>!p.via)){
      const q=modelToSvg(p);node("circle",{cx:q.x,cy:q.y,r:Math.max(.18,draft.width/2),fill:"#fff0aa"},overlay);
    }
    for(const via of copper.vias){
      const q=modelToSvg(via);
      node("circle",{cx:q.x,cy:q.y,r:via.diameter/2,fill:"#d3a552",stroke:"#fff0aa","stroke-width":.05},overlay);
      node("circle",{cx:q.x,cy:q.y,r:via.drill/2,fill:"#16332e"},overlay);
    }
  }
  function draftStatus(){
    const {layer}=routeDraftCopper(draft);
    onStatus("経由点 "+draft.waypoints.length+" 個 · "+(layer==="top"?"表面 F.Cu（同一ネットのパッドで確定）":"裏面 B.Cu（ビアで表面へ戻ってから確定）")+" · Backspaceで最後の点を取消");
  }
  function choosePad(element){
    const pin={ref:element.closest("[data-ref]").dataset.ref,pin:element.dataset.pad};
    try{
      if(!draft){
        draft=beginRouteDraft(project,footprintData,pin,routing.width());drawDraft();
        onStatus(pin.ref+":"+pin.pin+" / "+draft.net+" — 表面 F.Cu。Shift+クリックまたはビア指定で層を切替（Escで解除）");
      }else{
        const edit=finishRouteDraft(project,footprintData,draft,pin);
        if(routing.commit(edit))clearDraft();
      }
    }catch(e){onStatus(e.message)}
  }
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
        if(endpoint.ref!==ref)continue;
        const p=view==="schematic"?schematicPinPoint(pos,endpoint.pin):padPoint(pos,endpoint.pad);
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
    if(routeMode())return;
    if(view==="schematic"&&e.target.closest?.("[data-pin]"))return;
    clearPin();
    const g=group(e),p=point(e);if(!g||!p)return;
    const c=project.components.find(c=>c.ref===g.dataset.ref);if(!c)return;
    e.preventDefault();g.focus();svg.setPointerCapture(e.pointerId);
    drag={ref:c.ref,id:e.pointerId,position:c[view],start:p,moved:false};
  });
  svg.addEventListener("pointermove",e=>{
    if(routeMode()&&draft){
      const p=point(e);if(p)drawDraft(snapRoutePoint(p));return;
    }
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
  svg.addEventListener("pointerleave",()=>{if(routeMode()&&draft)drawDraft()});
  svg.addEventListener("click",e=>{
    if(routeMode()){
      const pad=e.target.closest?.("[data-pad]");
      if(pad&&svg.contains(pad)){pad.focus();choosePad(pad);return}
      if(draft&&e.target.hasAttribute?.("data-board")){
        svg.focus();
        const p=point(e);if(!p)return;
        try{
          const via=(e.shiftKey||routing.viaEnabled?.())?routing.viaDimensions?.():undefined;
          draft=appendRouteWaypoint(project,draft,p,via);
          if(via!==undefined)routing.clearVia?.();
          drawDraft();
          draftStatus();
        }catch(err){onStatus(err.message)}
      }
      return;
    }
    const pin=e.target.closest?.("[data-pin]");
    if(view==="schematic"&&pin&&svg.contains(pin)&&!drag){choosePin(pin);e.stopPropagation()}
  });
  svg.addEventListener("keydown",e=>{
    if(routeMode()){
      if(e.key==="Escape"){e.preventDefault();clearDraft();onStatus("配線選択を解除しました");return}
      if(e.key==="Backspace"&&draft){
        e.preventDefault();
        draft={...draft,waypoints:draft.waypoints.slice(0,-1)};
        routing.clearVia?.();drawDraft();draftStatus();return;
      }
      const pad=e.target.closest?.("[data-pad]");
      if(pad&&(e.key==="Enter"||e.key===" ")){e.preventDefault();choosePad(pad)}
      return;
    }
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
  return function render(next,catalog,footprints){
    cancel();clearPin();clearDraft();project=next;footprintData=footprints;svg.replaceChildren();groups.clear();edges.length=0;
    svg.setAttribute("viewBox",fitView(project,view).join(" "));
    if(view==="pcb"){
      const {width,height}=project.board;
      node("rect",{x:-width/2,y:-height/2,width,height,fill:"#16332e",stroke:"#61d1b3","stroke-width":.16,"data-board":"true"},svg);
      for(const route of project.routes??[]){
        try{
          const copper=routeCopper(project,footprints,route);
          for(const s of copper.segments){
            const a=modelToSvg(s.from),b=modelToSvg(s.to);
            const line=node("line",{x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:s.layer==="top"?"#db8251":"#75a7f5","stroke-width":s.width,"stroke-linecap":"round","pointer-events":"none"},svg);
            node("title",{},line,route.id+" / "+route.net+" / draft "+s.layer+" copper");
          }
          for(const via of copper.vias){
            const p=modelToSvg(via);
            const ring=node("circle",{cx:p.x,cy:p.y,r:via.diameter/2,fill:"#d3a552","pointer-events":"none"},svg);
            node("title",{},ring,route.id+" / "+route.net+" / through-via");
            node("circle",{cx:p.x,cy:p.y,r:via.drill/2,fill:"#16332e","pointer-events":"none"},svg);
          }
        }catch{/* unavailable route is reported in the route table */}
      }
      const byRef=new Map(project.components.map(c=>[c.ref,c]));
      for(const link of pcbPadLinks(project,footprints)){
        const a=padPoint(byRef.get(link.from.ref).pcb,link.from.pad),b=padPoint(byRef.get(link.to.ref).pcb,link.to.pad);
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
      groups.set(c.ref,drawComponent(svg,c,partById.get(c.lcsc),view,names,footprints?.parts?.[c.lcsc]));
    }
  }
}
