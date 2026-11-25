const $=id=>document.getElementById(id)
let project,tab="schematic",zoom=1,request=0
const validSlug=s=>/^[a-z0-9][a-z0-9-]*$/.test(s)
const add=(tag,text,parent)=>{const el=document.createElement(tag);el.textContent=text;parent.append(el);return el}
async function json(url){const r=await fetch(url,{cache:"no-cache"});if(!r.ok)throw new Error("HTTP "+r.status+" "+url);return r.json()}
function base(){return "projects/"+encodeURIComponent(project.id)+"/"}
function link(file,parent){if(!/^(?:draft\/)?[A-Za-z0-9_. -]+$/.test(file)||file.includes(".."))return;const p=add("p","",parent),a=add("a",file,p);a.href=base()+file;a.download=file.split("/").pop()}
function draw(){
  const c=$("content");c.replaceChildren();$("tools").hidden=!["schematic","pcb"].includes(tab)
  if(!project)return
  if(tab==="schematic"||tab==="pcb"){
    if(!project.files.includes(tab+".svg")){add("p","プレビュー未生成。検証結果を確認してください。",c);return}
    const img=document.createElement("img");img.alt=tab;img.src=base()+tab+".svg";img.style.width=(100*zoom)+"%";c.append(img)
    img.onerror=()=>{c.replaceChildren();add("p","プレビューの読み込みに失敗しました。",c)}
  }else if(tab==="parts"){
    const t=add("table","",c),head=add("tr","",t)
    for(const h of ["Ref","Value","Footprint","LCSC","Review"])add("th",h,head)
    for(const p of project.parts){const r=add("tr","",t);for(const v of [p.ref,p.value,p.footprint,p.lcsc||"未選定",p.reviewed?"Reviewed":"未確認"])add("td",v,r)}
  }else if(tab==="reports"){
    add("h2","製造リリース: 未承認",c)
    const messages=[...(project.errors||[]),...(project.blockers||[])]
    if(!messages.length)add("p","独立検証はまだ未実行です。",c)
    for(const m of messages)add("p",m,c)
    for(const f of project.files.filter(f=>/^(erc|drc|validation)\.json$/.test(f)))link(f,c)
  }else{
    add("h2","設計元データ・プレビュー",c)
    for(const f of project.files)link(f,c)
    add("h2","発注用データ",c)
    add("p","現段階では製造リリースを無効化しています。検証用データはGitHub ActionsのDRAFT成果物を参照してください。",c)
  }
}
async function load(id){
  if(!validSlug(id))return
  const token=++request
  try{const p=await json("projects/"+encodeURIComponent(id)+"/project.json");if(token!==request)return;if(p.id!==id)throw new Error("Project id mismatch");project=p;$("name").textContent=p.name;$("rev").textContent="Rev "+p.revision;$("purpose").textContent=p.purpose;$("state").textContent="発注不可 · "+p.status;zoom=1;draw()}catch(e){if(token!==request)return;project=null;$("content").textContent=String(e);$("state").textContent="読み込み失敗"}
}
document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{tab=b.dataset.tab;document.querySelectorAll("[data-tab]").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));draw()})
$("in").onclick=()=>{zoom=Math.min(4,zoom*1.25);draw()};$("out").onclick=()=>{zoom=Math.max(.25,zoom/1.25);draw()};$("reset").onclick=()=>{zoom=1;draw()}
$("projects").onchange=e=>load(e.target.value)
try{const projects=await json("projects.json");for(const p of projects.filter(p=>validSlug(p.id))){const o=add("option",p.name,$("projects"));o.value=p.id}if(!$("projects").options.length)throw new Error("No projects");$("projects").disabled=false;await load($("projects").value)}catch(e){$("state").textContent="ビルドデータがありません";$("content").textContent=String(e)}
