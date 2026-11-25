// Offline source patches, independent of rendering; never reuse old fabrication.
const dec=new TextDecoder('utf-8'),enc=new TextEncoder()
const check=(v,s)=>{if(!v)throw new Error(s)}
export const hash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('')
export const allowed={
 'PCB:LINE':['startX','startY','endX','endY','width'],
 'PCB:VIA':['centerX','centerY','viaDiameter','holeDiameter'],
 'PCB:COMPONENT':['x','y','angle'],
 'SCH_PAGE:COMPONENT':['x','y','rotation'],
 'SCH_PAGE:LINE':['startX','startY','endX','endY'],
 'SCH_PAGE:TEXT':['x','y','rotation','value']
}
export function records(bytes){
 const lines=dec.decode(bytes).split(/(?<=\n)/),items=[];let doc
 for(let i=0;i<lines.length;i++){
  const line=lines[i];if(!line.trim())continue
  const s=line.indexOf('||');check(s>0,'Invalid source record')
  const h=JSON.parse(line.slice(0,s)),body=line.slice(s+2).replace(/\r?\n$/,'');const raw=body.endsWith('|')?body.slice(0,-1):body
  const v=raw?JSON.parse(raw):null
  if(h.type==='DOCHEAD'){check(v&&v.docType&&v.uuid,'Missing document identity');doc={type:v.docType,uuid:v.uuid}}
  if(v!==null)items.push({i,doc,h,v})
 }
 return {lines,items}
}
export async function inspectSource(source){
 const documents=[]
 for(const [path,bytes] of Object.entries(source)){
  if(!/\.(epcb2|esch2)$/.test(path))continue
  const sha=await hash(bytes)
  for(const {doc,h,v} of records(bytes).items){
   const fields=allowed[doc?.type+':'+h.type];if(!fields||typeof h.id!=='string')continue
   const values=Object.fromEntries(fields.filter(k=>Object.hasOwn(v,k)).map(k=>[k,v[k]]))
   documents.push({path,baseSha256:sha,docType:doc.type,docUuid:doc.uuid,recordType:h.type,recordId:h.id,fields:values,net:v.netName??null})
  }
 }
 return {schema:'pcb-workbench-native-records/v1',documents,unitNotes:'PCB coordinates mil; schematic coordinates native 10mil; native angle conventions'}
}
export async function applyPatch(source,patch){
 check(patch?.schema==='pcb-workbench-native-patch/v1'&&Array.isArray(patch.changes)&&patch.changes.length>0&&patch.changes.length<=1000,'Invalid patch')
 const output={...source},seen=new Set(),log=[]
 for(const c of patch.changes){
  check(Object.hasOwn(source,c.path)&&/\.(epcb2|esch2)$/.test(c.path)&&await hash(source[c.path])===c.baseSha256,'Stale or missing source: '+c.path)
  const key=JSON.stringify([c.path,c.docType,c.docUuid,c.recordType,c.recordId]);check(!seen.has(key),'Duplicate target');seen.add(key)
  const fields=Object.keys(c.set??{}),expected=Object.keys(c.expect??{});const permitted=allowed[c.docType+':'+c.recordType]
  check(fields.length&&permitted&&fields.length===expected.length&&fields.every(f=>Object.hasOwn(c.expect,f)&&permitted.includes(f)),'Unsupported patch field')
  const {lines,items}=records(output[c.path]);const match=items.filter(x=>x.doc?.type===c.docType&&x.doc?.uuid===c.docUuid&&x.h.type===c.recordType&&x.h.id===c.recordId)
  check(match.length===1,'Missing or ambiguous record');const {i,v}=match[0]
  for(const field of fields){
   const value=c.set[field];check(Object.hasOwn(v,field)&&v[field]===c.expect[field],'Stale field: '+field)
   if(field==='value')check(typeof value==='string'&&value.length<=2000,'Invalid text')
   else check(typeof value==='number'&&Number.isFinite(value)&&(!['width','viaDiameter','holeDiameter'].includes(field)||value>0),'Invalid number')
  }
  Object.assign(v,c.set)
  check(c.recordType!=='VIA'||v.viaDiameter>v.holeDiameter&&v.holeDiameter>0,'Invalid via annulus')
  const original=lines[i],end=original.endsWith('\r\n')?'\r\n':original.endsWith('\n')?'\n':''
  lines[i]=original.slice(0,original.indexOf('||'))+'||'+JSON.stringify(v)+(original.replace(/\r?\n$/,'').endsWith('|')?'|':'')+end
  output[c.path]=enc.encode(lines.join(''));log.push({path:c.path,recordId:c.recordId,before:c.expect,after:c.set})
 }
 const hashes=Object.fromEntries(await Promise.all(Object.entries(output).map(async ([p,b])=>[p,await hash(b)])))
 return {source:output,report:{schema:'pcb-workbench-patch-report/v1',changes:log,sourceSha256:hashes,invalidated:['ERC','DRC','netlist','Gerber','BOM','CPL','3D'],orderReady:false}}
}
export function nativeSource(entries,board){
 const base=board.projectBase;check(typeof base==='string'&&base.startsWith('projects/'),'Missing project base')
 return Object.fromEntries(Object.entries(entries).filter(([p])=>p.startsWith(base)).map(([p,b])=>[p.slice(base.length),b]).filter(([p])=>/\.(eprj3|epcb2|esch2|ecfg|epan2|evar)$/.test(p)&&p.split('/').every(x=>x&&x!=='.'&&x!=='..')))
}
const cell=v=>'"'+String(v??'').replaceAll('"','""')+'"'
export const toCsv=(headers,rows)=>enc.encode([headers,...rows.map(r=>headers.map(h=>r[h]))].map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n')
export function reviewFiles(entries,board){
 const bom=board.bom.map(p=>({Comment:p.Comment,Designator:p.Designator,Footprint:p.Footprint,'LCSC Part #':p['LCSC Part #']??p['Supplier Part']}))
 check(bom.every(b=>/^C\d+$/.test(b['LCSC Part #'])),'Missing exact part identity')
 const cpl=board.cpl.map(p=>{
  check(['T','B'].includes(p.Layer),'Unknown native side')
  const n=v=>{const x=Number(String(v).replace(/mm$/i,''));check(Number.isFinite(x),'Invalid position');return x}
  return {Designator:p.Designator,'Mid X':n(p['Mid X']),'Mid Y':n(p['Mid Y']),Layer:p.Layer==='T'?'Top':'Bottom',Rotation:n(p.Rotation)}
 })
 const warnings=['Review-only unchanged baseline, not an approved order.','Native CAD reports are historical; no fresh ERC/DRC.','Verify exact JLCPCB stock, assembly capability, centroid and rotation for every part.','Verify physical fit and electrical/thermal behavior.']
 if(board.key==='Upper')warnings.push('CN7/CN10 are drawn Top but require underside THT; no automatic flip or guessed rotation.','Existing ERC warnings remain. C403774 sourcing must be rechecked.')
 if(board.key==='Lower')warnings.push('All five parts are THT; confirm assembly method and factory capability.')
 return {'Gerber.zip':entries[board.gerber],'BOM_REVIEW_ONLY.csv':toCsv(['Comment','Designator','Footprint','LCSC Part #'],bom),'CPL_AS_DRAWN_REVIEW_ONLY.csv':toCsv(['Designator','Mid X','Mid Y','Layer','Rotation'],cpl),'DO_NOT_ORDER.json':enc.encode(JSON.stringify({orderReady:false,sourcePcbSha256:board.pcbSha,warnings},null,2))}
}
