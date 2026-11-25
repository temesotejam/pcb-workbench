import {test,expect} from 'bun:test'
import {applyPatch,hash,records,reviewFiles} from './native-patch.mjs'
const enc=new TextEncoder(),dec=new TextDecoder()
const row=(h,v)=>JSON.stringify(h)+'||'+(v===null?'':JSON.stringify(v))+'|\r\n'
const source={'pcb/a.epcb2':enc.encode(row({type:'DOCHEAD'},{docType:'PCB',uuid:'p'})+row({type:'LINE',id:'l',ticket:2},{width:10,netName:'A'})+row({type:'POUR',id:'z'},{path:[[1,2,3]]})+row({type:'LINE',id:'deleted'},null))}
async function change(){return {schema:'pcb-workbench-native-patch/v1',changes:[{path:'pcb/a.epcb2',baseSha256:await hash(source['pcb/a.epcb2']),docType:'PCB',docUuid:'p',recordType:'LINE',recordId:'l',expect:{width:10},set:{width:12}}]}}
test('edits exactly one native line; preserves unsupported primitives and tombstones',async()=>{const r=await applyPatch(source,await change());const a=dec.decode(source['pcb/a.epcb2']).split('\r\n'),b=dec.decode(r.source['pcb/a.epcb2']).split('\r\n');expect(a.filter((v,i)=>v!==b[i]).length).toBe(1);expect(records(r.source['pcb/a.epcb2']).items.find(x=>x.h.id==='l').v.width).toBe(12);expect(r.report.orderReady).toBe(false);expect(r.report.invalidated).toContain('Gerber')})
test('reject stale file',async()=>{const p=await change();p.changes[0].baseSha256='0';await expect(applyPatch(source,p)).rejects.toThrow('Stale')})
test('reject mismatched old value',async()=>{const p=await change();p.changes[0].expect.width=11;await expect(applyPatch(source,p)).rejects.toThrow('Stale field')})
test('reject invalid geometry and net edits',async()=>{const p=await change();p.changes[0].set.width=0;await expect(applyPatch(source,p)).rejects.toThrow('Invalid number');p.changes[0].set={unsupportedField:'B'};p.changes[0].expect={unsupportedField:'A'};await expect(applyPatch(source,p)).rejects.toThrow('Unsupported')})
test('duplicate record patch rejected',async()=>{const p=await change();p.changes.push(p.changes[0]);await expect(applyPatch(source,p)).rejects.toThrow('Duplicate')})
test('candidate CPL never flips assembly side automatically',()=>{const board={key:'Upper',pcbSha:'test',gerber:'g',bom:[{Comment:'a',Designator:'CN7',Footprint:'f','LCSC Part #':'C1'}],cpl:[{Designator:'CN7','Mid X':'1mm','Mid Y':'-2mm',Rotation:'270',Layer:'T'}]};const files=reviewFiles({g:enc.encode('test')},board);expect(dec.decode(files.CPL_AS_DRAWN_REVIEW_ONLY_csv??files['CPL_AS_DRAWN_REVIEW_ONLY.csv'])).toContain('"Top"');expect(JSON.parse(dec.decode(files['DO_NOT_ORDER.json'])).orderReady).toBe(false)})

test('PCB component layerId can be changed between top and bottom only',async()=>{
 const pcb={'pcb/board.epcb2':enc.encode(
  row({type:'DOCHEAD'},{docType:'PCB',uuid:'p'})+
  row({type:'COMPONENT',id:'cn7'},{x:100,y:200,angle:90,layerId:1})
 )}
 const p={schema:'pcb-workbench-native-patch/v1',changes:[{
  path:'pcb/board.epcb2',baseSha256:await hash(pcb['pcb/board.epcb2']),docType:'PCB',docUuid:'p',recordType:'COMPONENT',recordId:'cn7',
  expect:{layerId:1},set:{layerId:2}
 }]}
 const result=await applyPatch(pcb,p)
 expect(records(result.source['pcb/board.epcb2']).items.find(x=>x.h.type==='COMPONENT').v.layerId).toBe(2)
 p.changes[0].set.layerId=3
 await expect(applyPatch(pcb,p)).rejects.toThrow('layerId must be 1 (Top) or 2 (Bottom)')
})
test('inspectSource includes component designators from native ATTR records',async()=>{
 const pcb={'pcb/board.epcb2':enc.encode(
  row({type:'DOCHEAD'},{docType:'PCB',uuid:'p'})+
  row({type:'COMPONENT',id:'cn7'},{x:100,y:200,angle:90,layerId:1})+
  row({type:'ATTR',id:'cn7e0'},{parentId:'cn7',key:'Designator',value:'CN7'})+
  row({type:'ATTR',id:'cn7e1'},{parentId:'cn7',key:'Unique ID',value:'lowerCN7'})
 )}
 const {inspectSource}=await import('./native-patch.mjs')
 const result=await inspectSource(pcb)
 const component=result.documents.find(x=>x.recordType==='COMPONENT')
 expect(component.designator).toBe('CN7')
 expect(component.uniqueId).toBe('lowerCN7')
 expect(component.fields.layerId).toBe(1)
})

test('existing PCB track net assignment is editable and invalidates fabrication',async()=>{
 const pcb={'pcb/board.epcb2':enc.encode(
  row({type:'DOCHEAD'},{docType:'PCB',uuid:'p'})+
  row({type:'LINE',id:'track'},{startX:0,startY:0,endX:100,endY:0,width:10,netName:'OLD_NET'})
 )}
 const p={schema:'pcb-workbench-native-patch/v1',changes:[{
  path:'pcb/board.epcb2',baseSha256:await hash(pcb['pcb/board.epcb2']),docType:'PCB',docUuid:'p',recordType:'LINE',recordId:'track',
  expect:{netName:'OLD_NET'},set:{netName:'NEW_NET'}
 }]}
 const result=await applyPatch(pcb,p)
 expect(records(result.source['pcb/board.epcb2']).items.find(x=>x.h.id==='track').v.netName).toBe('NEW_NET')
 expect(result.report.orderReady).toBe(false)
 expect(result.report.invalidated).toContain('DRC')
})
test('via net assignment is editable but rejects empty or multiline names',async()=>{
 const pcb={'pcb/board.epcb2':enc.encode(
  row({type:'DOCHEAD'},{docType:'PCB',uuid:'p'})+
  row({type:'VIA',id:'via'},{centerX:0,centerY:0,viaDiameter:24,holeDiameter:12,netName:'GND'})
 )}
 const p={schema:'pcb-workbench-native-patch/v1',changes:[{
  path:'pcb/board.epcb2',baseSha256:await hash(pcb['pcb/board.epcb2']),docType:'PCB',docUuid:'p',recordType:'VIA',recordId:'via',
  expect:{netName:'GND'},set:{netName:'3V3'}
 }]}
 const result=await applyPatch(pcb,p)
 expect(records(result.source['pcb/board.epcb2']).items.find(x=>x.h.id==='via').v.netName).toBe('3V3')
 p.changes[0].set.netName=''
 await expect(applyPatch(pcb,p)).rejects.toThrow('Invalid net name')
 p.changes[0].set.netName='BAD\\nNET'
 await expect(applyPatch(pcb,p)).rejects.toThrow('Invalid net name')
})
