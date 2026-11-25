import test from "node:test"
import assert from "node:assert/strict"
import {parseEnvelope,parseVersion,versionAtLeast,parseCsv,validateProjectFiles,checkBomCpl} from "./engine.mjs"
const enc=s=>new TextEncoder().encode(s)
test("CLI envelope accepts wrapped JSON and checks errors",()=>{assert.deepEqual(parseEnvelope('log\n{"ok":true,"value":{"x":1},"logs":[]}'),{x:1});assert.throws(()=>parseEnvelope('{"ok":false,"error":{"message":"no"}}'),/no/)})
test("version gate uses numeric segments",()=>{assert.deepEqual(parseVersion("EasyEDA Pro 4.1.105.abcdef"),[4,1,105]);assert.equal(versionAtLeast([4,1,105]),true);assert.equal(versionAtLeast([4,1,60]),false);assert.equal(versionAtLeast([4,2,0]),true)})
test("CSV parser handles commas, escaped quotes and CRLF",()=>{assert.deepEqual(parseCsv('A,B\r\n"x,y","z""z"\r\n'),[{A:"x,y",B:'z"z'}])})
test("project package must have one EPRJ3 and native docs",()=>{const p={"Demo.eprj3":enc(JSON.stringify({profile:{}})),"pcb/Board.epcb2":enc("x"),"sch/Main/Page.esch2":enc("x")};assert.equal(validateProjectFiles(p).projectName,"Demo");assert.throws(()=>validateProjectFiles({...p,"../escape.txt":enc("x")}),/Unsafe/);assert.throws(()=>validateProjectFiles({"pcb/Board.epcb2":enc("x")}),/EPRJ3/)})
test("BOM and CPL reference parity is enforced",()=>{const bom='Quantity,Designator,Supplier,Supplier Part\r\n1,R1,LCSC,C17414\r\n';const cpl='Designator,Mid X,Mid Y,Rotation,Layer\r\nR1,1,2,90,Top\r\n';assert.equal(checkBomCpl(bom,cpl).blockers.length,0);assert.ok(checkBomCpl(bom,cpl.replace('R1,1','R2,1')).blockers.length)})
