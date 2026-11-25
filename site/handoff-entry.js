import {unzipSync,zipSync} from 'fflate'
import {nativeSource,inspectSource,applyPatch,reviewFiles,hash} from '../library/native-patch.mjs'
import {inspectHandoff,selectedPath} from '../library/handoff-core.mjs'
const $=id=>document.getElementById(id), add=(parent,tag,text)=>{const e=document.createElement(tag);e.textContent=text??'';parent.append(e);return e}
let entries,report,board,tab='pcb',zoom=1,generation=0,urls=[],agentToken=null,agentImport=null,agentVerification=null,dirty=false
const clearUrls=()=>{for(const u of urls)URL.revokeObjectURL(u);urls=[]}
const objectUrl=(bytes,type)=>{const u=URL.createObjectURL(new Blob([bytes],{type}));urls.push(u);return u}
function normalizePath(p){if(selectedPath(p))return p;const i=p.indexOf('/');if(i>=0&&selectedPath(p.slice(i+1)))return p.slice(i+1);return null}
function readArchive(data){let total=0,root=null;const seen=new Set();const zip=unzipSync(data,{filter(f){const p=normalizePath(f.name);if(!p)return false;const prefix=f.name.slice(0,f.name.length-p.length);if(root===null)root=prefix;if(prefix!==root||seen.has(p))throw new Error('Duplicate or mixed archive roots');seen.add(p);total+=f.originalSize;if(f.originalSize>24*1024*1024||total>80*1024*1024)throw new Error('Selected archive files exceed size limits');return true}});const result=Object.create(null);for(const [name,bytes] of Object.entries(zip)){const p=normalizePath(name);if(p)result[p]=bytes}return result}
function download(bytes,name,type='application/json'){const a=document.createElement('a');a.download=name;a.href=objectUrl(bytes,type);a.click()}
function select(el,items){el.replaceChildren();for(const [v,n] of items){const o=add(el,'option',n);o.value=v}}
const q=()=> $('filter').value.trim().toLowerCase()
function table(rows,cols){const p=$('panel');const t=add(p,'table'),h=add(t,'tr');for(const k of cols)add(h,'th',k);for(const row of rows.filter(r=>!q()||Object.values(r).some(v=>String(v).toLowerCase().includes(q())))){const tr=add(t,'tr');for(const k of cols){const c=add(tr,'td',row[k]);if(k==='LCSC'&&/^C\d+$/.test(row[k])){c.textContent='';const a=add(c,'a',row[k]);a.href='https://jlcpcb.com/partdetail/'+row[k];a.target='_blank';a.rel='noopener noreferrer'}}}}
function image(path){const p=$('panel');if(!entries[path]){add(p,'p','原図がありません: '+path);return}const im=add(p,'img');im.src=objectUrl(entries[path],'image/png');im.alt=path.split('/').pop();im.style.width=(zoom*100)+'%'}
function routeView(){const p=$('panel');add(p,'p','ネイティブ配線・ビア・端子位置の確認用。銅箔ベタ、パッド外形、シルクは省略。正確な外形は元のPCB画像を参照。');const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');const coords=[...board.placements.map(x=>[+x['X mm'],-x['Y mm']]),...board.pads.map(x=>[x.x,-x.y]),...board.lines.flatMap(l=>[[l.x1,-l.y1],[l.x2,-l.y2]])].filter(x=>x.every(Number.isFinite));const w=Math.max(...coords.map(x=>x[0]))-Math.min(...coords.map(x=>x[0]))+8,h=Math.max(...coords.map(x=>x[1]))-Math.min(...coords.map(x=>x[1]))+8;svg.setAttribute('viewBox',[Math.min(...coords.map(x=>x[0]))-4,Math.min(...coords.map(x=>x[1]))-4,w,h].join(' '));svg.style.width=(zoom*100)+'%';p.append(svg);const elt=(tag,props)=>{const e=document.createElementNS(svg.namespaceURI,tag);for(const [k,v] of Object.entries(props))e.setAttribute(k,String(v));svg.append(e);return e};const layer=$('layer').value,match=x=>!q()||String(x??'').toLowerCase().includes(q()),col={1:'#f06c5b',2:'#6599ff',15:'#bc73d8',16:'#f2bb58'};for(const path of board.outlines){if(path[2]==='L'&&path.slice(3).every(Number.isFinite)){const pts=[[path[0],path[1]]];for(let i=3;i+1<path.length;i+=2)pts.push([path[i],path[i+1]]);elt('polyline',{points:pts.map(([x,y])=>x*.0254+','+-y*.0254).join(' '),fill:'none',stroke:'#b8d4c1','stroke-width':.2})}}for(const l of board.lines){if((layer==='all'||layer===String(l.layer))&&match(l.net))elt('line',{x1:l.x1,y1:-l.y1,x2:l.x2,y2:-l.y2,stroke:col[l.layer]||'#aaa','stroke-width':l.width,'stroke-linecap':'round'})}for(const v of board.vias)if(match(v.net))elt('circle',{cx:v.x,cy:-v.y,r:v.diameter/2,fill:'#d7b563',stroke:'#252b25','stroke-width':.08});for(const pad of board.pads)if(match(pad.net||pad.num)){if(Number.isFinite(pad.diameter))elt('circle',{cx:pad.x,cy:-pad.y,r:pad.diameter/2,fill:pad.plated?'#b4a26c':'#24332c',stroke:'#d9c79b','stroke-width':.08});if(Number.isFinite(pad.hole))elt('circle',{cx:pad.x,cy:-pad.y,r:pad.hole/2,fill:'#101815'})}for(const x of board.pins)if(match(x.Ref+' '+x.Pad+' '+x.Net))elt('circle',{cx:+x['X mm'],cy:-x['Y mm'],r:.32,fill:'#e8cf86'});for(const x of board.placements)if(match(x.Ref+' '+x.LCSC)){const t=elt('text',{x:+x['X mm'],y:-x['Y mm']-.6,fill:'#fff','font-size':1.4,'text-anchor':'middle'});t.textContent=x.Ref}}
function draw(){clearUrls();const p=$('panel');p.replaceChildren();$('sheet').hidden=tab!=='schematic';$('layer').hidden=tab!=='routes';$('filter').hidden=!['parts','pins','nets','routes'].includes(tab);$('minus').hidden=$('plus').hidden=!['pcb','schematic','routes'].includes(tab);if(!board)return;if(tab==='pcb')image(board.preview);else if(tab==='schematic')image(board.sheetFiles[+$('sheet').value||0].image);else if(tab==='routes')routeView();else if(tab==='parts')table(board.placements,['Ref','MPN','Manufacturer','LCSC','JLC class (CAD)','Footprint','CAD layer','Rotation deg','X mm','Y mm']);else if(tab==='pins')table(board.pins,['Ref','Pad','Schematic pin name','Net','X mm','Y mm']);else if(tab==='nets')table(board.nets,['Net','Pad count','Connected pads']);else if(tab==='native')nativePanel(p);else{add(p,'h2','既存の検証記録（独立再検証ではありません）');if(dirty)add(p,'p','設計変更済みです。元の検証結果・PCB画像・製造データは古くなっています。');add(p,'p','元のDRC: '+board.drc);add(p,'p','PCB SHA-256: '+board.pcbSha);for(const note of report.notes)add(p,'p',note);const raw=add(p,'pre',JSON.stringify(board.erc,null,2));for(const path of [board.pcbPath,...board.sheetFiles.map(s=>s.source),board.verification]){const b=add(p,'button','原本（閲覧用）: '+path.split('/').pop());b.onclick=()=>download(entries[path],path.split('/').pop(),'application/octet-stream')}add(p,'p','元Gerber/BOM/CPLはZIP原本に保持されています。現段階では発注用として再出力しません。')}}
function switchBoard(){board=report.boards[+$('board').value];$('title').textContent=board.name;select($('sheet'),board.sheetFiles.map((s,i)=>[i,s.title]));select($('layer'),[['all','全配線層'],...board.layers.filter(l=>[1,2,15,16].includes(l.id)).map(l=>[l.id,l.name])]);$('metrics').replaceChildren();for(const m of ['部品 '+board.placements.length,'端子 '+board.pins.length,'ネット '+board.nets.length,'回路図 '+board.sheetFiles.length+' 枚','LINE '+board.lines.length+' / VIA '+board.vias.length,'照合ファイル '+report.verifiedEntries])add($('metrics'),'p',m);zoom=1;$('filter').value='';draw()}
$('archive').onchange=async e=>{const file=e.target.files?.[0],token=++generation;if(!file)return;$('workspace').hidden=true;$('status').textContent='ZIPを読み込み、原本・部品・端子を照合中…';clearUrls();try{if(file.size>160*1024*1024)throw new Error('Archive exceeds 160 MiB');const data=readArchive(new Uint8Array(await file.arrayBuffer()));const checked=await inspectHandoff(data);if(token!==generation)return;entries=data;report=checked;dirty=false;agentImport=null;agentVerification=null;select($('board'),report.boards.map((b,i)=>[i,b.name]));$('status').textContent='照合完了: '+report.verifiedEntries+' ファイル。ローカル処理のみ。';$('workspace').hidden=false;switchBoard()}catch(err){if(token===generation)$('status').textContent='読み込み中止: '+err.message}}
$('board').onchange=switchBoard;$('sheet').onchange=draw;$('layer').onchange=draw;$('filter').oninput=draw;$('plus').onclick=()=>{zoom=Math.min(4,zoom*1.25);draw()};$('minus').onclick=()=>{zoom=Math.max(.25,zoom/1.25);draw()};$('report').onclick=()=>{if(report)download(JSON.stringify(report,null,2),'handoff-inspection.json')};document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;document.querySelectorAll('[data-tab]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));draw()})

async function localAgent(path,body,zip=false,meta=null){
 if(!agentToken){const boot=await fetch('/api/bootstrap');if(!boot.ok)throw new Error('ローカル起動スクリプトで開いてください');agentToken=(await boot.json()).token}
 const headers={'X-PWB-Token':agentToken};if(zip)headers['Content-Type']='application/zip';else headers['Content-Type']='application/json';if(meta?.baseHashes)headers['X-PWB-Base-Hashes']=JSON.stringify(meta.baseHashes)
 const r=await fetch('/api/'+path,{method:'POST',headers,body:zip?body:JSON.stringify(body??{})})
 const data=await r.json();if(!r.ok)throw new Error(data.error||('HTTP '+r.status));return data
}
function localEnginePanel(p){
 add(p,'h2','EasyEDA Pro ネイティブエンジン')
 add(p,'p','既に導入済みのEasyEDA Pro API Gateway / Bridge Serverへ接続します。49620〜49629番ポートを自動検索し、通信はローカル内だけで完結します。')
 const status=add(p,'p','未接続'),connect=add(p,'button','EasyEDA Proに接続'),windowSelect=add(p,'select',''),selectWindow=add(p,'button','選択したEasyEDAウィンドウを使用'),load=add(p,'button','選択中の基板を読み込む'),verify=add(p,'button','公式ERC / DRCを実行'),saveReport=add(p,'button','検証結果JSONを保存'),exp=add(p,'button','JLCPCB確認用データを生成'),close=add(p,'button','EasyEDAとの接続を解除'),details=add(p,'pre','')
 let windows=[]
 const show=x=>{status.textContent=x}
 connect.onclick=async()=>{connect.disabled=true;try{const r=await localAgent('health',{});windows=r.windows??[];windowSelect.replaceChildren();for(const w of windows){const id=w.id??w.windowId??w.uuid;if(!id)continue;const option=document.createElement('option');option.value=id;option.textContent=w.title??w.name??('EasyEDA window '+id);windowSelect.append(option)}if(r.activeWindowId)windowSelect.value=r.activeWindowId;show('Bridge接続済み · port '+r.port+' · EasyEDAウィンドウ '+windows.length+'件');details.textContent=JSON.stringify({health:r.health,windows,activeWindowId:r.activeWindowId},null,2)}catch(e){show('接続できません: '+e.message)}finally{connect.disabled=false}}
 selectWindow.onclick=async()=>{selectWindow.disabled=true;try{if(!windowSelect.value)throw new Error('EasyEDAウィンドウが見つかりません');const r=await localAgent('select-window',{windowId:windowSelect.value});agentImport=null;agentVerification=null;show('EasyEDAウィンドウを選択しました。対象基板を読み込んでください。');details.textContent=JSON.stringify(r,null,2)}catch(e){show('ウィンドウ選択失敗: '+e.message)}finally{selectWindow.disabled=false}}
 load.onclick=async()=>{load.disabled=true;try{if(!board.nativeBoardName)throw new Error('この引き継ぎデータにEasyEDAの板名がありません');agentImport=await localAgent('attach',{boardName:board.nativeBoardName});agentImport.boardName=board.name;agentVerification=null;show('ローカル読込済み · '+agentImport.projectName+' · '+agentImport.engineVersion);details.textContent=JSON.stringify(agentImport,null,2)}catch(e){show('読込失敗: '+e.message)}finally{load.disabled=false}}
 const nativeBoardName=()=>agentImport?.boards?.find(x=>x.pcbUuid)?.name
 saveReport.onclick=()=>{if(!agentVerification){show('先に公式ERC / DRCを実行してください');return}download(JSON.stringify(agentVerification,null,2),(agentImport?.projectName??'EasyEDA')+'-ERC-DRC-report.json','application/json')}
 verify.onclick=async()=>{verify.disabled=true;try{if(!agentImport||agentImport.boardName!==board.name)throw new Error('選択中の基板を先にローカルエンジンへ読み込んでください');const name=nativeBoardName();if(!name)throw new Error('ローカルプロジェクトに対応するPCBがありません');agentVerification=await localAgent('verify',{boardName:name});const ok=agentVerification.pcb?.passed&&agentVerification.schematicPassed;show('公式検証完了 · '+name+' · errors '+(agentVerification.errorCount??'不明')+' · warnings '+(agentVerification.warningCount??'不明')+' · '+(ok?'エラーなし（警告は要確認）':'エラーまたは詳細取得不可'));details.textContent=JSON.stringify(agentVerification,null,2)}catch(e){show('検証失敗: '+e.message)}finally{verify.disabled=false}}
 exp.onclick=async()=>{exp.disabled=true;try{const name=nativeBoardName();if(!name||!agentVerification||agentVerification.board?.name!==name)throw new Error('先に選択中の基板で公式ERC / DRCを実行してください');const r=await localAgent('export',{boardName:name});const raw=atob(r.zipBase64),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);download(bytes,r.fileName,'application/zip');show('確認用データを生成しました。発注承認ではありません。');details.textContent=JSON.stringify(r.manifest,null,2)}catch(e){show('出力失敗: '+e.message)}finally{exp.disabled=false}}
 close.onclick=async()=>{close.disabled=true;try{await localAgent('close',{});agentImport=null;agentVerification=null;show('ローカルセッションを終了しました')}catch(e){show('終了失敗: '+e.message)}finally{close.disabled=false}}
}
async function applyPatchText(patchText){
 if(agentImport&&agentImport.boardName!==board.name)throw new Error('接続中のEasyEDAプロジェクトと選択中の引き継ぎ基板が異なります。正しい基板へアタッチし直してください。')
 const source=nativeSource(entries,board)
 const baseHashes=Object.fromEntries(await Promise.all(Object.entries(source).map(async([name,data])=>[name,await hash(data)])))
 const r=await applyPatch(source,JSON.parse(patchText))
 const patchedEntries={...entries}
 for(const [rel,data] of Object.entries(r.source))patchedEntries[board.projectBase+rel]=data
 const patched=zipSync(r.source)
 const liveApplied=!!agentImport
 let updateResult=null
 if(liveApplied){updateResult=await localAgent('update',patched,true,{baseHashes});agentImport.sourceUpdated=true;agentImport.updateResult=updateResult}
 entries=patchedEntries;dirty=true;agentVerification=null
 download(zipSync({...r.source,'PATCH_REPORT.json':new TextEncoder().encode(JSON.stringify(r.report,null,2))}),board.key+'-PATCHED-UNVERIFIED.zip','application/zip')
 return {liveApplied,updateResult}
}
function nativePanel(p){
 localEnginePanel(p)
 add(p,'h2','設計元データ・AI差分')
 add(p,'p','原本を保持します。AIが作成したJSON差分を適用すると、変更したネイティブ設計だけを新しいZIPに出力します。回路図・配線・部品の位置変更後はEasyEDA公式エンジンで再検証が必要です。')
 const schematicWireEditor=add(p,'section','')
 add(schematicWireEditor,'h3','既存回路図ワイヤの端点編集')
 add(schematicWireEditor,'p','既存SCH_PAGE:LINEの始点・終点だけを編集します。線を移動するとシンボルピンやネットラベルから外れる可能性があります。電気的な接続は保証されません。')
 const wireRow=add(schematicWireEditor,'p',''),wireSelect=add(wireRow,'select',''),wireRefresh=add(wireRow,'button','回路図ワイヤを読み込む')
 const wireFields=add(schematicWireEditor,'div',''),wireInputs={}
 for(const [key,label] of [['startX','Start X (native)'],['startY','Start Y (native)'],['endX','End X (native)'],['endY','End Y (native)']]){
  const l=add(wireFields,'label',label+' '),input=add(l,'input');input.type='number';input.step='1';wireInputs[key]=input
 }
 const wireApply=add(schematicWireEditor,'button','回路図ワイヤの端点を変更')
 let schematicWires=[]
 const loadSchematicWires=async()=>{
  wireRefresh.disabled=true
  try{
   const inspection=await inspectSource(nativeSource(entries,board))
   schematicWires=inspection.documents.filter(x=>x.docType==='SCH_PAGE'&&x.recordType==='LINE'&&['startX','startY','endX','endY'].every(k=>Number.isFinite(x.fields[k])))
   const counts=new Map()
   for(const item of schematicWires)counts.set(item.recordId+'|'+item.path,(counts.get(item.recordId+'|'+item.path)||0)+1)
   schematicWires=schematicWires.filter(item=>counts.get(item.recordId+'|'+item.path)===1)
   wireSelect.replaceChildren()
   for(const item of schematicWires){const o=add(wireSelect,'option',item.recordId+' · ('+item.fields.startX+','+item.fields.startY+') → ('+item.fields.endX+','+item.fields.endY+')');o.value=item.recordId+'|'+item.path}
   if(!schematicWires.length)throw new Error('編集可能な回路図ワイヤがありません')
   for(const key of Object.keys(wireInputs))wireInputs[key].value=schematicWires[0].fields[key]
   status.textContent=schematicWires.length+'本の回路図ワイヤを編集対象として読み込みました。'
  }catch(e){status.textContent='回路図ワイヤ一覧の読み込み失敗: '+e.message}
  finally{wireRefresh.disabled=false}
 }
 wireSelect.onchange=()=>{
  const item=schematicWires.find(x=>x.recordId+'|'+x.path===wireSelect.value)
  if(!item)return
  for(const key of Object.keys(wireInputs))wireInputs[key].value=item.fields[key]
 }
 wireRefresh.onclick=loadSchematicWires
 wireApply.onclick=async()=>{
  wireApply.disabled=true
  try{
   const item=schematicWires.find(x=>x.recordId+'|'+x.path===wireSelect.value)
   if(!item)throw new Error('編集する回路図ワイヤを選択してください')
   const values=Object.fromEntries(Object.entries(wireInputs).map(([key,input])=>[key,Number(input.value)]))
   if(!Object.values(values).every(Number.isFinite))throw new Error('ワイヤ座標には有限の数値を入力してください')
   if(Math.hypot(values.endX-values.startX,values.endY-values.startY)<0.01)throw new Error('ワイヤ長が0に近すぎます')
   const set={},expect={}
   for(const key of Object.keys(values))if(values[key]!==item.fields[key]){set[key]=values[key];expect[key]=item.fields[key]}
   if(!Object.keys(set).length){status.textContent='変更はありません。';return}
   if(!confirm('回路図ワイヤ '+item.recordId+' の端点を変更します。\\nシンボルピン・接続点・ラベルから外れる可能性があります。続行しますか？'))return
   const patch={schema:'pcb-workbench-native-patch/v1',changes:[{path:item.path,baseSha256:item.baseSha256,docType:item.docType,docUuid:item.docUuid,recordType:item.recordType,recordId:item.recordId,expect,set}]}
   const result=await applyPatchText(JSON.stringify(patch))
   const rv=result.updateResult?.runtimeVerification
   status.textContent=result.liveApplied?(rv?.passed?'回路図ワイヤをEasyEDAへ反映し、再読込を確認しました。接続とERCを確認してください。':'書込み後の再読込確認が未完了です。製造データには使用しないでください。'):'回路図ワイヤ変更済みZIPを出力しました。EasyEDAで読み込み、接続とERCを確認してください。'
   schematicWires=[]
  }catch(e){status.textContent='回路図ワイヤ編集を中止しました: '+e.message}
  finally{wireApply.disabled=false}
 }
 const sourceButton=add(p,'button','元の編集可能な設計ZIP')
 sourceButton.onclick=()=>download(zipSync(nativeSource(entries,board)),board.key+'-native-source.zip','application/zip')
 const inspectButton=add(p,'button','AI編集用レコード一覧JSON')
 inspectButton.onclick=async()=>{try{download(JSON.stringify(await inspectSource(nativeSource(entries,board)),null,2),board.key+'-editable-records.json')}catch(e){status.textContent=e.message}}
 const lbl=add(p,'p','AI差分JSONを選択'),file=add(lbl,'input');file.type='file';file.accept='.json,application/json'
 const status=add(p,'p','原本は未変更です。')
 const editor=add(p,'section','')
 add(editor,'h3','部品の位置・角度を編集')
 add(editor,'p','PCBネイティブ座標（mil）で部品のX/Y位置と回転角を変更します。配線は自動追従しません。変更後はEasyEDAで配線・クリアランスを確認し、ERC/DRCを再実行してください。')
 const editRow=add(editor,'p','')
 const partSelect=add(editRow,'select','')
 const refresh=add(editRow,'button','部品一覧を読み込む')
 const fields=add(editor,'div','')
 const xInput=add(fields,'label','X (mil) '),xField=add(xInput,'input');xField.type='number';xField.step='1'
 const yInput=add(fields,'label','Y (mil) '),yField=add(yInput,'input');yField.type='number';yField.step='1'
 const angleInput=add(fields,'label','Rotation (deg) '),angleField=add(angleInput,'input');angleField.type='number';angleField.step='1'
 const applyPosition=add(editor,'button','位置・角度の変更を適用')
 let pcbComponents=[]
 const loadEditableComponents=async()=>{
  refresh.disabled=true
  try{
   const inspection=await inspectSource(nativeSource(entries,board))
   pcbComponents=inspection.documents.filter(x=>x.docType==='PCB'&&x.recordType==='COMPONENT'&&x.designator&&['x','y','angle'].every(k=>Number.isFinite(x.fields[k])))
   const counts=new Map()
   for(const item of pcbComponents)counts.set(item.designator,(counts.get(item.designator)||0)+1)
   pcbComponents=pcbComponents.filter(item=>counts.get(item.designator)===1)
   partSelect.replaceChildren()
   for(const item of pcbComponents){const o=add(partSelect,'option',item.designator+' · X '+item.fields.x+' / Y '+item.fields.y+' / '+item.fields.angle+'°');o.value=item.recordId}
   if(!pcbComponents.length)throw new Error('一意に識別できるPCB部品レコードがありません')
   const first=pcbComponents[0];xField.value=first.fields.x;yField.value=first.fields.y;angleField.value=first.fields.angle
   status.textContent=pcbComponents.length+'個の部品を編集対象として読み込みました。'
  }catch(e){status.textContent='部品一覧の読み込み失敗: '+e.message}
  finally{refresh.disabled=false}
 }
 partSelect.onchange=()=>{
  const item=pcbComponents.find(x=>x.recordId===partSelect.value)
  if(!item)return
  xField.value=item.fields.x;yField.value=item.fields.y;angleField.value=item.fields.angle
 }
 refresh.onclick=loadEditableComponents
 applyPosition.onclick=async()=>{
  applyPosition.disabled=true
  try{
   const item=pcbComponents.find(x=>x.recordId===partSelect.value)
   if(!item)throw new Error('編集する部品を選択してください')
   const values={x:Number(xField.value),y:Number(yField.value),angle:Number(angleField.value)}
   if(!Object.values(values).every(Number.isFinite))throw new Error('X/Y/角度には有限の数値を入力してください')
   if(Math.abs(values.angle)>3600)throw new Error('回転角は±3600°以内にしてください')
   const set={},expect={}
   for(const key of ['x','y','angle'])if(values[key]!==item.fields[key]){set[key]=values[key];expect[key]=item.fields[key]}
   if(!Object.keys(set).length){status.textContent='変更はありません。';return}
   if(!confirm(item.designator+' の位置・角度を変更します。\\nX: '+item.fields.x+' → '+values.x+' mil\\nY: '+item.fields.y+' → '+values.y+' mil\\n角度: '+item.fields.angle+' → '+values.angle+'°\\n\\n配線は自動修正されません。続行しますか？'))return
   const patch={schema:'pcb-workbench-native-patch/v1',changes:[{path:item.path,baseSha256:item.baseSha256,docType:item.docType,docUuid:item.docUuid,recordType:item.recordType,recordId:item.recordId,expect,set}]}
   const result=await applyPatchText(JSON.stringify(patch))
   const rv=result.updateResult?.runtimeVerification
   status.textContent=result.liveApplied?(rv?.passed?'位置・角度をEasyEDAへ反映し、再読込を確認しました。配線とERC/DRCを確認してください。':'書込み後の再読込確認が未完了です。製造データには使用しないでください。'):'変更済みZIPを出力しました。EasyEDAへ読み込み、配線とERC/DRCを確認してください。'
   pcbComponents=[]
  }catch(e){status.textContent='編集を中止しました: '+e.message}
  finally{applyPosition.disabled=false}
 }
 const schEditor=add(p,'section','')
 add(schEditor,'h3','回路図部品の位置・向きを編集')
 add(schEditor,'p','回路図ネイティブ座標（10 mil単位）で部品シンボルのX/Y位置と回転を変更します。電気的な接続・ネットは変更しません。')
 const schRow=add(schEditor,'p',''),schSelect=add(schRow,'select',''),schRefresh=add(schRow,'button','回路図部品を読み込む')
 const sxLabel=add(schEditor,'label','X (native) '),sx=add(sxLabel,'input');sx.type='number';sx.step='1'
 const syLabel=add(schEditor,'label','Y (native) '),sy=add(syLabel,'input');sy.type='number';sy.step='1'
 const srLabel=add(schEditor,'label','Rotation (deg) '),sr=add(srLabel,'input');sr.type='number';sr.step='90'
 const schApply=add(schEditor,'button','回路図部品の位置・向きを適用')
 let schComponents=[]
 const loadSchematicComponents=async()=>{
  schRefresh.disabled=true
  try{
   const inspection=await inspectSource(nativeSource(entries,board))
   schComponents=inspection.documents.filter(x=>x.docType==='SCH_PAGE'&&x.recordType==='COMPONENT'&&x.designator&&['x','y','rotation'].every(k=>Number.isFinite(x.fields[k])))
   const counts=new Map()
   for(const item of schComponents)counts.set(item.designator,(counts.get(item.designator)||0)+1)
   schComponents=schComponents.filter(item=>counts.get(item.designator)===1)
   schSelect.replaceChildren()
   for(const item of schComponents){const o=add(schSelect,'option',item.designator+' · X '+item.fields.x+' / Y '+item.fields.y+' / '+item.fields.rotation+'°');o.value=item.recordId+'|'+item.path}
   if(!schComponents.length)throw new Error('一意に識別できる回路図部品レコードがありません')
   const first=schComponents[0];sx.value=first.fields.x;sy.value=first.fields.y;sr.value=first.fields.rotation
   status.textContent=schComponents.length+'個の回路図部品を編集対象として読み込みました。'
  }catch(e){status.textContent='回路図部品一覧の読み込み失敗: '+e.message}
  finally{schRefresh.disabled=false}
 }
 schSelect.onchange=()=>{
  const item=schComponents.find(x=>x.recordId+'|'+x.path===schSelect.value)
  if(!item)return
  sx.value=item.fields.x;sy.value=item.fields.y;sr.value=item.fields.rotation
 }
 schRefresh.onclick=loadSchematicComponents
 schApply.onclick=async()=>{
  schApply.disabled=true
  try{
   const item=schComponents.find(x=>x.recordId+'|'+x.path===schSelect.value)
   if(!item)throw new Error('編集する回路図部品を選択してください')
   const values={x:Number(sx.value),y:Number(sy.value),rotation:Number(sr.value)}
   if(!Object.values(values).every(Number.isFinite))throw new Error('X/Y/回転には有限の数値を入力してください')
   if(Math.abs(values.rotation)>3600)throw new Error('回転角は±3600°以内にしてください')
   const set={},expect={}
   for(const key of ['x','y','rotation'])if(values[key]!==item.fields[key]){set[key]=values[key];expect[key]=item.fields[key]}
   if(!Object.keys(set).length){status.textContent='変更はありません。';return}
   if(!confirm(item.designator+' の回路図上の位置・向きを変更します。\\nX: '+item.fields.x+' → '+values.x+'\\nY: '+item.fields.y+' → '+values.y+'\\n回転: '+item.fields.rotation+' → '+values.rotation+'°\\n\\n電気的な接続は変更しません。続行しますか？'))return
   const patch={schema:'pcb-workbench-native-patch/v1',changes:[{path:item.path,baseSha256:item.baseSha256,docType:item.docType,docUuid:item.docUuid,recordType:item.recordType,recordId:item.recordId,expect,set}]}
   const result=await applyPatchText(JSON.stringify(patch))
   const rv=result.updateResult?.runtimeVerification
   status.textContent=result.liveApplied?(rv?.passed?'回路図部品の位置・向きをEasyEDAへ反映し、再読込を確認しました。ERC/DRCを再実行してください。':'書込み後の再読込確認が未完了です。製造データには使用しないでください。'):'回路図変更済みZIPを出力しました。EasyEDAで読み込み、表示とERC/DRCを確認してください。'
   schComponents=[]
  }catch(e){status.textContent='回路図編集を中止しました: '+e.message}
  finally{schApply.disabled=false}
 }
 const routeEditor=add(p,'section','')
 add(routeEditor,'h3','既存配線トラックの形状編集')
 add(routeEditor,'p','既存のPCB:LINEレコードのみを編集します。端点を動かすとパッド・ビアから外れて未接続になる場合があります。自動配線・ネット変更・新規トラック追加は行いません。必ずEasyEDAで接続状態とDRCを再確認してください。')
 const routeRow=add(routeEditor,'p',''),routeSelect=add(routeRow,'select',''),routeRefresh=add(routeRow,'button','配線トラックを読み込む')
 const trackFields=add(routeEditor,'div','')
 const trackInputs={}
 for(const [key,label,step] of [['startX','Start X (mil)','1'],['startY','Start Y (mil)','1'],['endX','End X (mil)','1'],['endY','End Y (mil)','1'],['width','Width (mil)','0.1']]){
  const l=add(trackFields,'label',label+' '),input=add(l,'input');input.type='number';input.step=step;trackInputs[key]=input
 }
 const routeApply=add(routeEditor,'button','配線形状の変更を適用')
 let routeRecords=[]
 const loadRouteRecords=async()=>{
  routeRefresh.disabled=true
  try{
   const inspection=await inspectSource(nativeSource(entries,board))
   routeRecords=inspection.documents.filter(x=>x.docType==='PCB'&&x.recordType==='LINE'&&['startX','startY','endX','endY','width'].every(k=>Number.isFinite(x.fields[k]))&&x.fields.width>0)
   const counts=new Map()
   for(const item of routeRecords)counts.set(item.recordId,(counts.get(item.recordId)||0)+1)
   routeRecords=routeRecords.filter(item=>counts.get(item.recordId)===1)
   routeSelect.replaceChildren()
   for(const item of routeRecords){const o=add(routeSelect,'option',(item.net||'No net')+' · '+item.recordId+' · ('+item.fields.startX+','+item.fields.startY+') → ('+item.fields.endX+','+item.fields.endY+')');o.value=item.recordId+'|'+item.path}
   if(!routeRecords.length)throw new Error('編集可能な配線トラックがありません')
   const first=routeRecords[0];for(const key of Object.keys(trackInputs))trackInputs[key].value=first.fields[key]
   status.textContent=routeRecords.length+'本の既存トラックを編集対象として読み込みました。'
  }catch(e){status.textContent='配線一覧の読み込み失敗: '+e.message}
  finally{routeRefresh.disabled=false}
 }
 routeSelect.onchange=()=>{
  const item=routeRecords.find(x=>x.recordId+'|'+x.path===routeSelect.value)
  if(!item)return
  for(const key of Object.keys(trackInputs))trackInputs[key].value=item.fields[key]
 }
 routeRefresh.onclick=loadRouteRecords
 const netRow=add(routeEditor,'p',''),netLabel=add(netRow,'label','Track net name '),trackNet=add(netLabel,'select');for(const n of board.nets){const o=add(trackNet,'option',n.Net);o.value=n.Net}
 const netApply=add(routeEditor,'button','選択トラックのネット名を変更')
 routeSelect.addEventListener('change',()=>{const item=routeRecords.find(x=>x.recordId+'|'+x.path===routeSelect.value);if(item)trackNet.value=item.fields.netName??item.net??''})
 netApply.onclick=async()=>{
  netApply.disabled=true
  try{
   const item=routeRecords.find(x=>x.recordId+'|'+x.path===routeSelect.value)
   if(!item||typeof item.fields.netName!=='string')throw new Error('ネイティブデータに編集可能なネット名がありません')
   const next=trackNet.value.trim()
   if(!next||next.length>256||/[\\r\\n\\0]/.test(next))throw new Error('ネット名が不正です')
   if(next===item.fields.netName){status.textContent='ネット名に変更はありません。';return}
   if(!confirm('トラック '+item.recordId+' のネットを '+item.fields.netName+' から '+next+' に変更します。\\nこの1本だけの変更です。接続先パッド・他の配線・ビアは変更されず、ネット分断や短絡の原因になる可能性があります。続行しますか？'))return
   const patch={schema:'pcb-workbench-native-patch/v1',changes:[{path:item.path,baseSha256:item.baseSha256,docType:item.docType,docUuid:item.docUuid,recordType:item.recordType,recordId:item.recordId,expect:{netName:item.fields.netName},set:{netName:next}}]}
   const result=await applyPatchText(JSON.stringify(patch))
   status.textContent=result.liveApplied?'トラックのネット名を変更しました。必ずERC/DRCと接続状態を再確認してください。':'ネット名変更済みZIPを出力しました。EasyEDAで読み込み、ERC/DRCを確認してください。'
   routeRecords=[]
  }catch(e){status.textContent='ネット変更を中止しました: '+e.message}
  finally{netApply.disabled=false}
 }
 routeApply.onclick=async()=>{
  routeApply.disabled=true
  try{
   const item=routeRecords.find(x=>x.recordId+'|'+x.path===routeSelect.value)
   if(!item)throw new Error('編集する配線トラックを選択してください')
   const values=Object.fromEntries(Object.entries(trackInputs).map(([key,input])=>[key,Number(input.value)]))
   if(!Object.values(values).every(Number.isFinite))throw new Error('配線座標と幅には有限の数値を入力してください')
   if(values.width<=0||values.width>500)throw new Error('配線幅は0より大きく500 mil以下にしてください')
   if(Math.hypot(values.endX-values.startX,values.endY-values.startY)<0.01)throw new Error('配線長が0に近すぎます')
   const set={},expect={}
   for(const key of Object.keys(values))if(values[key]!==item.fields[key]){set[key]=values[key];expect[key]=item.fields[key]}
   if(!Object.keys(set).length){status.textContent='変更はありません。';return}
   if(!confirm('既存トラック '+item.recordId+' ('+(item.net||'No net')+') の形状を変更します。\\n端点移動により接続が切れる可能性があります。ネット名は変更されません。\\n続行しますか？'))return
   const patch={schema:'pcb-workbench-native-patch/v1',changes:[{path:item.path,baseSha256:item.baseSha256,docType:item.docType,docUuid:item.docUuid,recordType:item.recordType,recordId:item.recordId,expect,set}]}
   const result=await applyPatchText(JSON.stringify(patch))
   const rv=result.updateResult?.runtimeVerification
   status.textContent=result.liveApplied?(rv?.passed?'既存トラックの形状をEasyEDAへ反映し、再読込を確認しました。接続・DRCを確認してください。':'書込み後の再読込確認が未完了です。製造データには使用しないでください。'):'配線変更済みZIPを出力しました。EasyEDAで読み込み、接続とDRCを確認してください。'
   routeRecords=[]
  }catch(e){status.textContent='配線編集を中止しました: '+e.message}
  finally{routeApply.disabled=false}
 }
 const viaEditor=add(p,'section','')
 add(viaEditor,'h3','既存ビアの位置・寸法編集')
 add(viaEditor,'p','既存PCB:VIAレコードの中心座標・外径・穴径を変更します。層構成やネット接続を新規作成する機能ではありません。製造前に必ずDRCとドリルデータを確認してください。')
 const viaRow=add(viaEditor,'p',''),viaSelect=add(viaRow,'select',''),viaRefresh=add(viaRow,'button','ビア一覧を読み込む')
 const viaFields=add(viaEditor,'div',''),viaInputs={}
 for(const [key,label,step] of [['centerX','Center X (mil)','1'],['centerY','Center Y (mil)','1'],['viaDiameter','Via diameter (mil)','0.1'],['holeDiameter','Hole diameter (mil)','0.1']]){
  const l=add(viaFields,'label',label+' '),input=add(l,'input');input.type='number';input.step=step;viaInputs[key]=input
 }
 const viaApply=add(viaEditor,'button','ビアの変更を適用')
 let viaRecords=[]
 const loadViaRecords=async()=>{
  viaRefresh.disabled=true
  try{
   const inspection=await inspectSource(nativeSource(entries,board))
   viaRecords=inspection.documents.filter(x=>x.docType==='PCB'&&x.recordType==='VIA'&&['centerX','centerY','viaDiameter','holeDiameter'].every(k=>Number.isFinite(x.fields[k]))&&x.fields.viaDiameter>x.fields.holeDiameter&&x.fields.holeDiameter>0)
   const counts=new Map()
   for(const item of viaRecords)counts.set(item.recordId,(counts.get(item.recordId)||0)+1)
   viaRecords=viaRecords.filter(item=>counts.get(item.recordId)===1)
   viaSelect.replaceChildren()
   for(const item of viaRecords){const o=add(viaSelect,'option',(item.net||'No net')+' · '+item.recordId+' · ('+item.fields.centerX+','+item.fields.centerY+')');o.value=item.recordId+'|'+item.path}
   if(!viaRecords.length)throw new Error('編集可能なビアレコードがありません')
   for(const key of Object.keys(viaInputs))viaInputs[key].value=viaRecords[0].fields[key]
   status.textContent=viaRecords.length+'個の既存ビアを編集対象として読み込みました。'
  }catch(e){status.textContent='ビア一覧の読み込み失敗: '+e.message}
  finally{viaRefresh.disabled=false}
 }
 viaSelect.onchange=()=>{
  const item=viaRecords.find(x=>x.recordId+'|'+x.path===viaSelect.value)
  if(!item)return
  for(const key of Object.keys(viaInputs))viaInputs[key].value=item.fields[key]
 }
 viaRefresh.onclick=loadViaRecords
 const viaNetRow=add(viaEditor,'p',''),viaNetLabel=add(viaNetRow,'label','Via net name '),viaNet=add(viaNetLabel,'select');for(const n of board.nets){const o=add(viaNet,'option',n.Net);o.value=n.Net}
 const viaNetApply=add(viaEditor,'button','選択ビアのネット名を変更')
 viaSelect.addEventListener('change',()=>{const item=viaRecords.find(x=>x.recordId+'|'+x.path===viaSelect.value);if(item)viaNet.value=item.fields.netName??item.net??''})
 viaNetApply.onclick=async()=>{
  viaNetApply.disabled=true
  try{
   const item=viaRecords.find(x=>x.recordId+'|'+x.path===viaSelect.value)
   if(!item||typeof item.fields.netName!=='string')throw new Error('ネイティブデータに編集可能なネット名がありません')
   const next=viaNet.value.trim()
   if(!next||next.length>256||/[\\r\\n\\0]/.test(next))throw new Error('ネット名が不正です')
   if(next===item.fields.netName){status.textContent='ネット名に変更はありません。';return}
   if(!confirm('ビア '+item.recordId+' のネットを '+item.fields.netName+' から '+next+' に変更します。\\nこのビアだけの変更です。接続トラックは変更されず、ネット分断や短絡の原因になる可能性があります。続行しますか？'))return
   const patch={schema:'pcb-workbench-native-patch/v1',changes:[{path:item.path,baseSha256:item.baseSha256,docType:item.docType,docUuid:item.docUuid,recordType:item.recordType,recordId:item.recordId,expect:{netName:item.fields.netName},set:{netName:next}}]}
   const result=await applyPatchText(JSON.stringify(patch))
   status.textContent=result.liveApplied?'ビアのネット名を変更しました。必ずERC/DRCと接続状態を再確認してください。':'ビアのネット名変更済みZIPを出力しました。EasyEDAで読み込み、ERC/DRCを確認してください。'
   viaRecords=[]
  }catch(e){status.textContent='ビアのネット変更を中止しました: '+e.message}
  finally{viaNetApply.disabled=false}
 }
 viaApply.onclick=async()=>{
  viaApply.disabled=true
  try{
   const item=viaRecords.find(x=>x.recordId+'|'+x.path===viaSelect.value)
   if(!item)throw new Error('編集するビアを選択してください')
   const values=Object.fromEntries(Object.entries(viaInputs).map(([key,input])=>[key,Number(input.value)]))
   if(!Object.values(values).every(Number.isFinite))throw new Error('ビア寸法と座標には有限の数値を入力してください')
   if(values.viaDiameter<=values.holeDiameter||values.holeDiameter<=0||values.viaDiameter>500||values.holeDiameter>500)throw new Error('ビア外径は穴径より大きく、両方500 mil以下にしてください')
   const set={},expect={}
   for(const key of Object.keys(values))if(values[key]!==item.fields[key]){set[key]=values[key];expect[key]=item.fields[key]}
   if(!Object.keys(set).length){status.textContent='変更はありません。';return}
   if(!confirm('既存ビア '+item.recordId+' ('+(item.net||'No net')+') を変更します。\\nビア径・穴径・位置の変更によりDRCや製造条件が変わります。続行しますか？'))return
   const patch={schema:'pcb-workbench-native-patch/v1',changes:[{path:item.path,baseSha256:item.baseSha256,docType:item.docType,docUuid:item.docUuid,recordType:item.recordType,recordId:item.recordId,expect,set}]}
   const result=await applyPatchText(JSON.stringify(patch))
   const rv=result.updateResult?.runtimeVerification
   status.textContent=result.liveApplied?(rv?.passed?'ビア変更をEasyEDAへ反映し、再読込を確認しました。DRCとドリル出力を確認してください。':'書込み後の再読込確認が未完了です。製造データには使用しないでください。'):'ビア変更済みZIPを出力しました。EasyEDAで読み込み、DRCとドリル出力を確認してください。'
   viaRecords=[]
  }catch(e){status.textContent='ビア編集を中止しました: '+e.message}
  finally{viaApply.disabled=false}
 }
 if(board.nativeBoardName==="NUCLEO-F401RE Rev1.5"){
  const underside=add(p,'button','CN7 / CN10 を裏面へ移動（確認付き）')
  underside.onclick=async()=>{
   underside.disabled=true
   try{
    const source=nativeSource(entries,board),inspection=await inspectSource(source)
    const targets=inspection.documents.filter(x=>x.docType==="PCB"&&x.recordType==="COMPONENT"&&["CN7","CN10"].includes(x.designator))
    if(targets.length!==2)throw new Error("CN7/CN10 のネイティブ部品レコードを一意に特定できません")
    if(targets.some(x=>![1,2].includes(x.fields.layerId)))throw new Error("CN7/CN10 の現在の layerId が不明です")
    const changes=targets.filter(x=>x.fields.layerId===1).map(x=>({
     path:x.path,baseSha256:x.baseSha256,docType:x.docType,docUuid:x.docUuid,recordType:x.recordType,recordId:x.recordId,
     expect:{layerId:1},set:{layerId:2}
    }))
    if(!changes.length){status.textContent="CN7/CN10 は既にBottom layerです。";return}
    const refs=targets.map(x=>x.designator+" : "+(x.fields.layerId===1?"Top → Bottom":"Bottom（変更なし）")).join("\\n")
    if(!confirm("上基板の実装面を変更します。\\n"+refs+"\\n\\n回転角は変更しません。適用後にERC/DRCとJLCPCBの底面配置・回転プレビューを必ず確認してください。\\n\\n続行しますか？"))return
    const patch={schema:"pcb-workbench-native-patch/v1",changes}
    const result=await applyPatchText(JSON.stringify(patch))
    const rv=result.updateResult?.runtimeVerification
    status.textContent=result.liveApplied?(rv?.passed?"CN7/CN10のBottom配置を反映し、EasyEDA再読込を確認しました。ERC/DRCを再実行してください。":"書込み後の再読込確認が未完了です。発注データは使わず詳細を確認してください。"):"Bottom配置パッチをブラウザ内に適用しました。出力ZIPをEasyEDAへ読み込んでください。"
   }catch(e){status.textContent="裏面配置変更を中止: "+e.message}
   finally{underside.disabled=false}
  }
 }
 file.onchange=async()=>{try{const f=file.files?.[0];if(!f)return;if(f.size>5*1024*1024)throw new Error('Patch too large');const patchText=await f.text();const result=await applyPatchText(patchText);const rv=result.updateResult?.runtimeVerification;status.textContent=result.liveApplied?(rv?.passed?'EasyEDA Proへの反映とPCB・回路図の再読込確認が完了しました。ERC / DRCを再実行してください。':'ファイル書込みは完了しましたが、EDA側の再読込確認は未完了です。発注データは使わず、詳細を確認してください。'):'差分をブラウザ内に適用し、編集用ZIPを出力しました。EasyEDAへの反映には接続・アタッチが必要です。'}catch(e){status.textContent='差分適用中止: '+e.message}}
 add(p,'h2','変更前の製造資料')
 add(p,'p','既存Gerberと形式整理済みBOM/CPLを照合用として出力します。上下実装、在庫、ERC等は未承認。発注用として使用しないでください。')
 const b=add(p,'button','製造確認用ZIP（発注不可）')
 b.onclick=()=>{try{if(dirty)throw new Error('設計変更後の古いGerber/BOM/CPLは出力できません。ローカルEasyEDA Proで再検証・再出力してください。');const files=reviewFiles(entries,board);const gerber=unzipSync(files['Gerber.zip']);const ext=new Set(Object.keys(gerber).filter(k=>gerber[k].length).map(k=>k.split('.').pop().toUpperCase()));for(const k of ['GTL','GBL','GTS','GBS','GKO','DRL',...(board.key==='Upper'?['G1','G2','GTP']:[])])if(!ext.has(k))throw new Error('Missing Gerber layer '+k);download(zipSync(files),board.key+'-REVIEW-ONLY.zip','application/zip')}catch(e){status.textContent='出力中止: '+e.message}}
}
