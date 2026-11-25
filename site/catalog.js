const $=id=>document.getElementById(id)
const cell=(row,tag,value)=>{const el=document.createElement(tag);el.textContent=String(value??"未確認");row.append(el);return el}
const official=id=>"https://jlcpcb.com/partdetail/"+id
function normalizeId(v){const s=String(v??"").trim().toUpperCase();return /^C\d+$/.test(s)?s:/^\d+$/.test(s)?"C"+s:null}
function rowLink(row,id){const td=cell(row,"td",""),a=document.createElement("a");a.textContent=id;a.href=official(id);a.target="_blank";a.rel="noopener noreferrer";td.append(a)}
function renderRows(target,parts,live=false){
 target.replaceChildren()
 if(!parts.length){cell(target,"p","一致する部品はありません。");return}
 const table=document.createElement("table"),header=document.createElement("tr")
 for(const name of ["JLCPCB番号","メーカー型番","Package","仕様 / 説明","区分","在庫（参考）","単価（参考）","操作"])cell(header,"th",name)
 table.append(header)
 for(const p of parts){
  const id=normalizeId(p.lcsc);if(!id)continue
  const row=document.createElement("tr")
  rowLink(row,id)
  cell(row,"td",p.manufacturerPart??p.mfr??p.mpn??"未確認")
  cell(row,"td",p.package)
  cell(row,"td",p.description)
  cell(row,"td",live?"要公式確認":p.tier)
  cell(row,"td",live?p.stock:"未確認")
  cell(row,"td",live&&typeof p.price==="string"?p.price:"未確認")
  const action=cell(row,"td",""),button=document.createElement("button")
  button.textContent="部品番号をコピー"
  button.onclick=async()=>{try{await navigator.clipboard.writeText(id);$("catalog-status").textContent=id+" をコピーしました。チャットで指定できます。"}catch{$("catalog-status").textContent="部品番号: "+id}}
  action.append(button);table.append(row)
 }
 target.append(table)
}
export async function initCatalog(){
 let catalog
 try{const r=await fetch("catalog.json");if(!r.ok)throw new Error("HTTP "+r.status);catalog=(await r.json()).parts}
 catch(e){$("catalog-status").textContent="登録部品の読み込み失敗: "+e;catalog=[]}
 const local=() => {
  const q=$("catalog-query").value.trim().toLowerCase(),pkg=$("catalog-package").value.trim().toLowerCase()
  renderRows($("catalog-local"),catalog.filter(p=>(!q||[p.lcsc,p.manufacturerPart,p.manufacturer,p.description,p.kind,p.value].join(" ").toLowerCase().includes(q))&&(!pkg||p.package.toLowerCase()===pkg)))
 }
 $("catalog-query").addEventListener("input",local);$("catalog-package").addEventListener("input",local);local()
 $("catalog-search").addEventListener("submit",async e=>{
  e.preventDefault();const q=$("catalog-query").value.trim(),pkg=$("catalog-package").value.trim()
  if(!q){$("catalog-status").textContent="検索語かC番号を入力してください。";return}
  const button=$("catalog-submit");button.disabled=true;$("catalog-live").replaceChildren();$("catalog-status").textContent="外部の部品検索サービスへ問い合わせ中…"
  try{
   const url=new URL("https://jlcsearch.tscircuit.com/api/search");url.searchParams.set("q",q);url.searchParams.set("limit","30");url.searchParams.set("full","true");if(pkg)url.searchParams.set("package",pkg)
   const res=await fetch(url,{credentials:"omit",signal:AbortSignal.timeout(15000)})
   if(!res.ok)throw new Error("HTTP "+res.status)
   const data=await res.json();if(!Array.isArray(data.components))throw new Error("Unexpected response")
   const hits=data.components.filter(p=>p&&normalizeId(p.lcsc)).slice(0,30)
   renderRows($("catalog-live"),hits,true)
   $("catalog-status").textContent=hits.length+" 件（非公式集約データ・取得 "+new Date().toLocaleString("ja-JP")+"）。JLCPCB公式ページで実装可否・最新在庫・価格を確認してください。"
  }catch(e){$("catalog-status").textContent="外部検索を取得できません: "+e.message+"。登録済み部品または公式サイトを利用してください。"}
  finally{button.disabled=false}
 })
}
