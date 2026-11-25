import {test,expect} from 'bun:test'
import {csv,nativeDoc,selectedPath,inspectHandoff} from './handoff-core.mjs'
test('quoted CSV and CRLF',()=>expect(csv('A,B\r\n"x,y","z""z"\r\n')).toEqual([{A:'x,y',B:'z"z'}]))
test('malformed CSV rejected',()=>expect(()=>csv('A,B\nx')).toThrow())
test('only selected current files, no backup or history',()=>{expect(selectedPath('projects/test/pcb/Board.epcb2')).toBe(true);expect(selectedPath('history/pcb/Board.epcb2')).toBe(false);expect(selectedPath('projects/test/../x.epcb2')).toBe(false)})
test('native parser selects linked document and ignores null tombstones',()=>{const doc=[['DOCHEAD',{docType:'PCB',uuid:'board'}],['LINE',{x:1}],['LINE',null],['DOCHEAD',{docType:'SYMBOL',uuid:'symbol'}],['LINE',{x:2}]].map(([type,v])=>JSON.stringify({type})+'||'+(v===null?'':JSON.stringify(v))+'|').join('\n');expect(nativeDoc(doc,'PCB','board').map(x=>x.type)).toEqual(['DOCHEAD','LINE']);expect(()=>nativeDoc(doc,'PCB','other')).toThrow()})
test('incomplete archive fails closed',async()=>{await expect(inspectHandoff({})).rejects.toThrow('Missing MANIFEST.csv')})
test('tampered manifest fails before parsing',async()=>{const b=s=>new TextEncoder().encode(s);await expect(inspectHandoff({'MANIFEST.csv':b('Path,Bytes,SHA256\ncurrent_upper/verification.json,2,0000\n'),'current_upper/verification.json':b('{}')})).rejects.toThrow('Manifest mismatch')})
