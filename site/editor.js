import {createProject,validateProject,applyEdit,inspectProject} from "./project-model.js";
import {attachGraphicEditor} from "./editor-graphics.js";
import {routeCopper,parseWaypoints} from "./route-geometry.js";
import {inspectDraftClearance} from "./copper-clearance.js";
const $=id=>document.getElementById(id);
const key="pcb-workbench.native-project.v1";
let catalog,project,footprints;
const el=(tag,text,parent)=>{const node=document.createElement(tag);if(text!==null)node.textContent=text;if(parent)parent.append(node);return node};
function option(select,value,text){const o=el("option",text,select);o.value=value;return o}
function button(parent,text,click){const b=el("button",text,parent);b.type="button";b.onclick=click;return b}
function status(message){$("status").textContent=message}
function setProject(next,message){
  validateProject(next,catalog);
  project=next;
  try{localStorage.setItem(key,JSON.stringify(project));status(message+" · ブラウザ保存済み")}
  catch{status(message+" · 自動保存不可。JSON保存してください")}
  render();
}
function action(edit){try{setProject(applyEdit(project,edit,catalog),"変更を反映しました")}catch(e){status(e.message)}}
const renderSchematic=attachGraphicEditor($("schematic-view"),"schematic",action,status);
const renderPcb=attachGraphicEditor($("pcb-view"),"pcb",action,status,{
  enabled:()=>$("route-mode").checked,
  width:()=>$("route-width").valueAsNumber,
  viaEnabled:()=>$("route-via-next").checked,
  viaDimensions:()=>({diameter:$("route-via-diameter").valueAsNumber,drill:$("route-via-drill").valueAsNumber}),
  clearVia:()=>{$("route-via-next").checked=false},
  commit:addRoute
});
$("route-mode").onchange=()=>{
  if(!project)return;
  renderPcb(project,catalog,footprints);
  status($("route-mode").checked?"配線モード：始点の実パッドを選んでください":"配置モード：部品の移動・回転");
};
function table(parent,headers){parent.replaceChildren();const t=el("table",null,parent),h=el("tr",null,el("thead",null,t));for(const title of headers)el("th",title,h);return el("tbody",null,t)}
function placement(parent,c,view){
  const f=el("form",null,parent),inputs=[];
  for(const name of ["x","y"]){const input=el("input",null,f);input.type="number";input.step="any";input.required=true;input.min="-10000";input.max="10000";input.value=c[view][name];input.setAttribute("aria-label",c.ref+" "+view+" "+name);inputs.push(input)}
  const rot=el("select",null,f);rot.setAttribute("aria-label",c.ref+" "+view+" rotation");
  for(const deg of [0,90,180,270])option(rot,String(deg),deg+"°");rot.value=String(c[view].rotation);
  el("button","適用",f);f.onsubmit=e=>{e.preventDefault();action({type:"place",ref:c.ref,view,x:inputs[0].valueAsNumber,y:inputs[1].valueAsNumber,rotation:Number(rot.value)})};
}
function render(){
  $("project-name").value=project.name;$("width").value=project.board.width;$("height").value=project.board.height;
  const parts=table($("components"),["Ref / LCSC","値 / Package","回路図 x,y,角度","PCB x,y,角度","ピン1 / ピン2","操作"]);
  for(const c of project.components){
    const p=catalog.parts.find(p=>p.lcsc===c.lcsc),row=el("tr",null,parts);
    el("td",c.ref+" / "+c.lcsc,row);el("td",p.value+" / "+p.package,row);
    for(const view of ["schematic","pcb"])placement(el("td",null,row),c,view);
    const cell=el("td",null,row);
    for(const pin of ["1","2"]){const label=el("label","Pin "+pin,cell),select=el("select",null,label);option(select,"","未接続");
      for(const n of project.nets)option(select,n.name,n.name);
      select.value=project.nets.find(n=>n.pins.some(x=>x.ref===c.ref&&x.pin===pin))?.name??"";
      select.onchange=()=>action({type:"assign-pin",ref:c.ref,pin,name:select.value||null});
    }
    button(el("td",null,row),"削除",()=>action({type:"remove-component",ref:c.ref}));
  }
  const nets=table($("nets"),["ネット","接続ピン","操作"]);
  for(const n of project.nets){const row=el("tr",null,nets);el("td",n.name,row);el("td",n.pins.map(p=>p.ref+":"+p.pin).join(", ")||"未接続",row);button(el("td",null,row),"削除",()=>action({type:"remove-net",name:n.name}))}
  renderRoutes();
  renderZones();
  renderClearance();
  renderSchematic(project,catalog);renderPcb(project,catalog,footprints);
  const missing=project.components.filter(c=>footprints?.parts?.[c.lcsc]?.pads?.length!==2).map(c=>c.ref);
  $("footprint-status").textContent=missing.length?"実パッド未取得: "+missing.join(", ")+"。関連する接続線は表示しません。":"登録部品の取得済み実パッドを表示（製造承認なし）。";
  const report=inspectProject(project,catalog);$("diagnostics").textContent=report.issues.length?report.issues.join("\n"):"論理検査の指摘なし（製造可否は未確認）";
}
function renderClearance(){
  const output=$("copper-diagnostics");
  if(!project)return;
  try{
    const report=inspectDraftClearance(project,footprints,$("draft-clearance").valueAsNumber);
    const lines=[report.complete?"仮配線同士の検査: "+report.totalFindings+" 件":"検査未完了（"+(report.reason??"実パッド・配線形状が未取得")+"）: 検出済み "+report.totalFindings+" 件"];
    for(const f of report.findings)lines.push(f.a+" ["+f.netA+"] / "+f.b+" ["+f.netB+"] "+(f.layer==="top"?"F.Cu":"B.Cu")+" "+(f.kind==="overlap"?"銅箔接触・重なり":"間隔不足")+" "+f.gapMm.toFixed(3)+" mm");
    if(report.totalFindings>report.findings.length)lines.push("表示は先頭 "+report.findings.length+" 件");
    for(const f of report.unavailable.slice(0,20))lines.push(f.id+": "+f.message);
    if(project.zones?.length)lines.unshift("銅箔ゾーンは未充填・検査対象外です。");
    output.textContent=lines.join("\n");
  }catch(e){output.textContent="検査できません: "+e.message}
}
$("draft-clearance").oninput=renderClearance;
function renderRoutes(){
  const selects=[$("route-from"),$("route-to")];
  for(const select of selects){
    select.replaceChildren();option(select,"","選択");
    for(const net of project.nets)for(const pin of net.pins){
      const c=project.components.find(c=>c.ref===pin.ref);
      if(footprints?.parts?.[c.lcsc]?.pads?.some(p=>p.pin===pin.pin))option(select,pin.ref+":"+pin.pin,pin.ref+":"+pin.pin+" / "+net.name);
    }
  }
  const rows=table($("routes"),["ID / Net","端点","幅 mm","経由点","状態","操作"]);
  for(const route of project.routes??[]){
    const row=el("tr",null,rows);
    el("td",route.id+" / "+route.net,row);
    el("td",route.from.ref+":"+route.from.pin+" → "+route.to.ref+":"+route.to.pin,row);
    el("td",String(route.width),row);el("td",route.waypoints.map(p=>[p.x,p.y,...(p.via?[p.via.diameter,p.via.drill]:[])].join(",")).join(" / ")||"直線",row);
    let note="仮配線・DRC未実施";
    try{routeCopper(project,footprints,route);if(route.waypoints.some(p=>p.via))note="両面仮配線・独立製造検証が必要"}catch(e){note="表示不可: "+e.message}
    el("td",note,row);button(el("td",null,row),"削除",()=>action({type:"remove-route",id:route.id}));
  }
}
function renderZones(){
  const select=$("zone-net"),previous=select.value;
  select.replaceChildren();option(select,"","選択");
  for(const n of project.nets)option(select,n.name,n.name);
  if(project.nets.some(n=>n.name===previous))select.value=previous;
  const rows=table($("zones"),["ID / Net","層","範囲 mm","参考間隔 mm","操作"]);
  for(const z of project.zones??[]){
    const row=el("tr",null,rows),b=z.bounds;
    el("td",z.id+" / "+z.net,row);el("td",z.layer==="top"?"F.Cu":"B.Cu",row);
    el("td",b.xMin+","+b.yMin+" → "+b.xMax+","+b.yMax,row);el("td",String(z.clearance),row);
    const cell=el("td",null,row);
    button(cell,"編集",()=>{
      $("zone-id").value=z.id;$("zone-net").value=z.net;$("zone-layer").value=z.layer;$("zone-clearance").value=z.clearance;
      for(const k of ["xMin","yMin","xMax","yMax"])$("zone-"+k).value=b[k];
      $("zone-submit").textContent=z.id+" 更新";
    });
    button(cell,"削除",()=>{resetZoneEdit();action({type:"remove-zone",id:z.id})});
  }
  if(!project.zones?.some(z=>z.id===$("zone-id").value))resetZoneEdit();
}
function resetZoneEdit(){$("zone-id").value="";$("zone-submit").textContent="ゾーン追加"}
$("zone-cancel").onclick=resetZoneEdit;
$("zone-form").onsubmit=e=>{
  e.preventDefault();
  try{
    const id=$("zone-id").value,bounds=Object.fromEntries(["xMin","yMin","xMax","yMax"].map(k=>[k,$("zone-"+k).valueAsNumber]));
    const next=applyEdit(project,{type:id?"update-zone":"add-zone",id,net:$("zone-net").value,layer:$("zone-layer").value,clearance:$("zone-clearance").valueAsNumber,bounds},catalog);
    resetZoneEdit();setProject(next,"未充填ゾーンの範囲を保存しました（製造変換不可）");
  }catch(err){status(err.message)}
};
function addRoute(edit){
  try{
    const next=applyEdit(project,edit,catalog);
    routeCopper(next,footprints,next.routes.at(-1));
    setProject(next,"仮配線を追加しました（製造出力不可）");
    return true;
  }catch(err){status(err.message);return false}
}
$("route-form").onsubmit=e=>{
  e.preventDefault();
  try{
    const pin=id=>{const [ref,pin]=$(id).value.split(":");return {ref,pin}};
    if(addRoute({type:"add-route",from:pin("route-from"),to:pin("route-to"),width:$("route-width").valueAsNumber,waypoints:parseWaypoints($("route-points").value)}))$("route-points").value="";
  }catch(err){status(err.message)}
};
try{
  const response=await fetch("catalog.json");if(!response.ok)throw new Error("Catalog HTTP "+response.status);catalog=await response.json();
  try{const res=await fetch("footprint-preview.json");if(!res.ok)throw new Error("HTTP "+res.status);const data=await res.json();if(data.version===1&&data.parts)footprints=data}catch{/* editor stays usable without geometry */}
  for(const p of catalog.parts.filter(p=>["resistor","capacitor"].includes(p.kind)))option($("part"),p.lcsc,p.lcsc+" / "+p.value+" / "+p.package);
  project=createProject();let message="新規プロジェクト";
  try{const stored=localStorage.getItem(key);if(stored){project=validateProject(JSON.parse(stored),catalog);message="保存済みプロジェクトを復元しました"}}
  catch(e){message="保存データを復元できません: "+e.message+"。既存データは変更していません";}
  $("controls").hidden=false;status(message);render();
}catch(e){status("初期化失敗: "+e.message)}
$("board-form").onsubmit=e=>{e.preventDefault();try{const next=applyEdit(applyEdit(project,{type:"rename",name:$("project-name").value},catalog),{type:"board",width:$("width").valueAsNumber,height:$("height").valueAsNumber},catalog);setProject(next,"プロジェクト更新")}catch(err){status(err.message)}};
$("new").onclick=()=>{if(confirm("現在のプロジェクトを置換します。必要に応じて先にJSON保存してください。"))(resetZoneEdit(),setProject(createProject(),"新規作成"))};
$("add-component").onsubmit=e=>{e.preventDefault();action({type:"add-component",lcsc:$("part").value})};
$("add-net").onsubmit=e=>{e.preventDefault();action({type:"add-net",name:$("net-name").value})};
$("export").onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(project,null,2)],{type:"application/json"})),a=el("a",null,document.body);a.href=url;a.download="pcb-workbench-project.json";a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)};
$("manufacture").onclick=async()=>{
  const button=$("manufacture"), report=$("manufacture-status");
  if(!project||button.disabled)return;
  const snapshot=JSON.stringify(project);
  button.disabled=true;report.textContent="製造サービスを確認中…";
  try{
    if(!globalThis.crypto?.subtle)throw Error("製造ZIPの照合にはHTTPSまたはlocalhostが必要です");
    const sha256=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
    const sourceHash=await sha256(new TextEncoder().encode(snapshot));
    const endpoint=new URL("/api/manufacture",location.origin);
    const probe=await fetch(endpoint,{cache:"no-store",redirect:"error"});
    if(!probe.ok||!probe.headers.get("content-type")?.includes("application/json"))throw Error("製造サービス未接続（GitHub Pages単体では利用不可）");
    const info=await probe.json();
    if(info.service!=="pcbwb-manufacturing-v1"||info.orderReady!==false)throw Error("未対応の製造サービス");
    report.textContent="独立検証中…";
    const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:snapshot,cache:"no-store",redirect:"error"});
    if(!response.ok){
      let message="製造検証失敗 (HTTP "+response.status+")";
      if(response.headers.get("content-type")?.includes("application/json"))message=(await response.json()).error||message;
      throw Error(message);
    }
    if(!response.headers.get("content-type")?.startsWith("application/zip"))throw Error("不正な製造レスポンス");
    if(response.headers.get("X-PCBWB-Source-SHA256")!==sourceHash)throw Error("製造元の設計ハッシュが一致しません");
    const bundleHash=response.headers.get("X-PCBWB-Bundle-SHA256");
    if(!bundleHash||!/^[0-9a-f]{64}$/.test(bundleHash))throw Error("製造ZIPの照合情報がありません");
    const maxBytes=34*1024*1024;
    const declared=response.headers.get("Content-Length");
    if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>maxBytes))throw Error("製造ZIPのサイズが不正です");
    if(!response.body)throw Error("製造ZIPがありません");
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{
      for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw Error("製造ZIPが大きすぎます")}chunks.push(value)}
    }finally{reader.releaseLock()}
    const bytes=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
    if(size<4||bytes[0]!==80||bytes[1]!==75||bytes[2]!==3||bytes[3]!==4||await sha256(bytes)!==bundleHash)throw Error("製造ZIPの内容が一致しません");
    const url=URL.createObjectURL(new Blob([bytes],{type:"application/zip"})),a=el("a",null,document.body);
    a.href=url;a.download="PCBWB-DRAFT-DO-NOT-ORDER.zip";a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    report.textContent="レビュー用ZIP取得（発注不可）"+(snapshot!==JSON.stringify(project)?"。クリック時点の設計です。現在の編集内容とは異なります。":"");
  }catch(e){report.textContent="取得不可: "+e.message}
  finally{button.disabled=false}
};
$("import").onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>2000000)throw new Error("JSONが大きすぎます");const next=validateProject(JSON.parse(await file.text()),catalog);if(confirm("現在のプロジェクトを置換しますか？"))(resetZoneEdit(),setProject(next,"JSONを読み込みました"))}catch(err){status("読込失敗: "+err.message)}finally{e.target.value=""}};
