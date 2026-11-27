import {createProject,validateProject,applyEdit,inspectProject} from "./project-model.js";
import {attachGraphicEditor} from "./editor-graphics.js";
import {routeCopper,parseWaypoints} from "./route-geometry.js";
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
  renderSchematic(project,catalog);renderPcb(project,catalog,footprints);
  const missing=project.components.filter(c=>footprints?.parts?.[c.lcsc]?.pads?.length!==2).map(c=>c.ref);
  $("footprint-status").textContent=missing.length?"実パッド未取得: "+missing.join(", ")+"。関連する接続線は表示しません。":"登録部品の取得済み実パッドを表示（製造承認なし）。";
  const report=inspectProject(project,catalog);$("diagnostics").textContent=report.issues.length?report.issues.join("\n"):"論理検査の指摘なし（製造可否は未確認）";
}
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
$("new").onclick=()=>{if(confirm("現在のプロジェクトを置換します。必要に応じて先にJSON保存してください。"))setProject(createProject(),"新規作成")};
$("add-component").onsubmit=e=>{e.preventDefault();action({type:"add-component",lcsc:$("part").value})};
$("add-net").onsubmit=e=>{e.preventDefault();action({type:"add-net",name:$("net-name").value})};
$("export").onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(project,null,2)],{type:"application/json"})),a=el("a",null,document.body);a.href=url;a.download="pcb-workbench-project.json";a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)};
$("import").onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>2000000)throw new Error("JSONが大きすぎます");const next=validateProject(JSON.parse(await file.text()),catalog);if(confirm("現在のプロジェクトを置換しますか？"))setProject(next,"JSONを読み込みました")}catch(err){status("読込失敗: "+err.message)}finally{e.target.value=""}};
