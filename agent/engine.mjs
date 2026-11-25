import { execFile } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import os from "node:os"
import { randomUUID, createHash } from "node:crypto"
import { mkdir, writeFile, rm, access, readFile, readdir } from "node:fs/promises"
import { unzipSync, zipSync } from "fflate"
const execFileAsync=promisify(execFile)
export async function hashProjectDir(dir){
 const hashes=Object.create(null),allowed=new Set([".eprj3",".epcb2",".esch2",".ecfg",".evar",".epan2"])
 async function walk(current){
  for(const entry of await readdir(current,{withFileTypes:true})){
   const full=path.join(current,entry.name)
   if(entry.isDirectory())await walk(full)
   else if(entry.isFile()&&allowed.has(path.extname(entry.name).toLowerCase())){
    const rel=path.relative(dir,full).split(path.sep).join("/")
    hashes[rel]=createHash("sha256").update(await readFile(full)).digest("hex")
   }
  }
 }
 await walk(dir)
 const sourceRevision=createHash("sha256").update(JSON.stringify(Object.entries(hashes).sort((a,b)=>a[0].localeCompare(b[0])))).digest("hex")
 return {hashes,sourceRevision}
}
export function parseEnvelope(stdout){const s=String(stdout??""),a=s.indexOf("{"),b=s.lastIndexOf("}");if(a<0||b<a)throw new Error("EasyEDA CLI returned no JSON envelope");const r=JSON.parse(s.slice(a,b+1));if(r.ok!==true)throw new Error(r.error?.message||r.error?.code||"EasyEDA CLI operation failed");return r.value}
export function parseVersion(text){const m=String(text).match(/EasyEDA Pro\s+(\d+)\.(\d+)\.(\d+|x)/i);return m?[Number(m[1]),Number(m[2]),/^x$/i.test(m[3])?null:Number(m[3])]:null}
export function versionAtLeast(v,min=[4,1,60],allowUnknownPatch=false){if(!v)return false;if(v[0]!==min[0])return v[0]>min[0];if(v[1]!==min[1])return v[1]>min[1];if(v[2]===null)return allowUnknownPatch;return v[2]>=min[2]}
export function parseCsv(text){
 const s=String(text).replace(/^\uFEFF/,""),rows=[]
 let delimiter=",",first="",quoted=false
 for(let i=0;i<s.length;i++){
  const c=s[i]
  if(c==='"'&&(!quoted||s[i+1]==='"')){if(quoted&&s[i+1]==='"')i++;else quoted=!quoted}
  else if(!quoted&&(c==="\n"||c==="\r"))break
  else if(!quoted)first+=c
 }
 if((first.match(/\t/g)||[]).length>(first.match(/,/g)||[]).length)delimiter="\t"
 let row=[],cell="",inQuotes=false
 for(let i=0;i<s.length;i++){
  const c=s[i]
  if(inQuotes){
   if(c==='"'&&s[i+1]==='"'){cell+='"';i++}
   else if(c==='"')inQuotes=false
   else cell+=c
  }else if(c==='"'&&cell==="")inQuotes=true
  else if(c===delimiter){row.push(cell);cell=""}
  else if(c==="\n"){row.push(cell.replace(/\r$/,""));if(row.some(x=>x!==""))rows.push(row);row=[];cell=""}
  else cell+=c
 }
 if(inQuotes)throw new Error("Unclosed CSV quote")
 if(row.length||cell){row.push(cell.replace(/\r$/,""));if(row.some(x=>x!==""))rows.push(row)}
 if(!rows.length)return []
 const headers=rows.shift().map(x=>x.trim())
 if(new Set(headers).size!==headers.length)throw new Error("Duplicate CSV headers")
 return rows.map(values=>{if(values.length!==headers.length)throw new Error("CSV column count mismatch");return Object.fromEntries(headers.map((h,i)=>[h,values[i]]))})
}
export function validateProjectFiles(input){const entries=Object.create(null);let totalBytes=0;if(Object.keys(input).length>2000)throw new Error('Too many project files');for(const [rawName,data] of Object.entries(input)){const name=rawName.replace(/\\/g,"/");if(!name||name.startsWith("/")||/^[A-Za-z]:/.test(name)||name.split("/").some(x=>x===".."||x==="."||!x))throw new Error("Unsafe project path: "+rawName);if(!/\.(eprj3|epcb2|esch2|ecfg|evar|epan2)$/i.test(name))throw new Error("Unsupported file in native project package: "+name);if(entries[name])throw new Error("Duplicate project path: "+name);const bytes=data instanceof Uint8Array?data:new Uint8Array(data);if(bytes.byteLength>64*1024*1024)throw new Error('Project file exceeds 64 MiB: '+name);totalBytes+=bytes.byteLength;if(totalBytes>220*1024*1024)throw new Error('Project exceeds 220 MiB');entries[name]=bytes}const projects=Object.keys(entries).filter(x=>x.toLowerCase().endsWith(".eprj3"));if(projects.length!==1||projects[0].includes("/"))throw new Error("Package must contain exactly one root-level .eprj3 project file");const projectName=path.basename(projects[0],".eprj3"),pcb=Object.keys(entries).filter(x=>x.toLowerCase().endsWith(".epcb2")),sch=Object.keys(entries).filter(x=>x.toLowerCase().endsWith(".esch2"));if(!pcb.length||!sch.length)throw new Error("Project needs at least one PCB and one schematic source");const meta=JSON.parse(new TextDecoder().decode(entries[projects[0]]));if(!meta.profile||typeof meta.profile!=="object")throw new Error("Invalid EPRJ3 project profile");return {entries,projectName,projectFile:projects[0]}}
export function checkBomCpl(bomText,cplText){
 const bom=parseCsv(bomText),cpl=parseCsv(cplText),blockers=[],warnings=[],bRefs=[],cRefs=[]
 const numeric=v=>Number(String(v??"").trim().replace(/mm$/i,""))
 const bomNormalized=[]
 for(const row of bom){
  const raw=row.Designator??row["Designator(s)"]??"",refs=String(raw).split(",").map(x=>x.trim()).filter(Boolean)
  if(!refs.length)blockers.push("BOM row has no designator")
  const qty=Number(row.Quantity)
  if(Number.isFinite(qty)&&qty!==refs.length)blockers.push("BOM quantity mismatch for "+raw)
  bRefs.push(...refs)
  const part=String(row["LCSC Part #"]??row["Supplier Part"]??"").trim()
  if(!/^C\d+$/i.test(part))blockers.push("Missing or invalid LCSC part number for "+raw+": "+part)
  const supplier=String(row.Supplier??"").trim().toLowerCase()
  if(supplier&&supplier!=="lcsc")blockers.push("Supplier is not LCSC for "+raw+": "+supplier)
  const comment=String(row.Comment??row["Manufacturer Part"]??row.Device??row.Value??"").trim()
  const footprint=String(row.Footprint??"").trim()
  if(!footprint)blockers.push("Missing footprint for "+raw)
  bomNormalized.push({Comment:comment,Designator:refs.join(","),Footprint:footprint,"LCSC Part #":part,Quantity:String(Number.isFinite(qty)?qty:refs.length)})
 }
 const cplNormalized=[]
 for(const row of cpl){
  const ref=String(row.Designator??"").trim()
  if(!ref)blockers.push("CPL row has no designator");else cRefs.push(ref)
  const smdRaw=String(row.SMD??"").trim().toLowerCase()
  const smd=["yes","true","1","smd"].includes(smdRaw)?"Yes":["no","false","0","tht"].includes(smdRaw)?"No":""
  if(smd==="No")warnings.push("Through-hole assembly capability must be confirmed: "+ref)
  if(!smd)warnings.push("SMD/THT type is not specified in CPL: "+ref)
  const layer=String(row.Layer??"").trim().toLowerCase()
  if(!["top","bottom","t","b","front","back"].includes(layer))blockers.push("Unknown CPL layer for "+ref+": "+layer)
  if(["CN7","CN10"].includes(ref)&&["top","t","front"].includes(layer))warnings.push(ref+" is on the top side in the native CPL; verify the required underside THT orientation before PCBA.")
  const x=numeric(row["Mid X"]),y=numeric(row["Mid Y"]),rot=numeric(row.Rotation)
  for(const [field,value] of [["Mid X",x],["Mid Y",y],["Rotation",rot]])if(!Number.isFinite(value))blockers.push("Invalid CPL "+field+" for "+ref)
  cplNormalized.push({Designator:ref,"Mid X":Number.isFinite(x)?x.toFixed(4):String(row["Mid X"]??""),"Mid Y":Number.isFinite(y)?y.toFixed(4):String(row["Mid Y"]??""),Layer:["bottom","b","back"].includes(layer)?"Bottom":"Top",Rotation:Number.isFinite(rot)?rot.toFixed(4):String(row.Rotation??""),SMD:smd})
 }
 const dup=xs=>xs.filter((v,i)=>xs.indexOf(v)!==i)
 if(dup(bRefs).length)blockers.push("Duplicate BOM designators: "+[...new Set(dup(bRefs))].join(", "))
 if(dup(cRefs).length)blockers.push("Duplicate CPL designators: "+[...new Set(dup(cRefs))].join(", "))
 const bs=new Set(bRefs),cs=new Set(cRefs),missing=[...bs].filter(x=>!cs.has(x)),extra=[...cs].filter(x=>!bs.has(x))
 if(missing.length)blockers.push("Missing from CPL: "+missing.join(", "))
 if(extra.length)blockers.push("CPL references not in BOM: "+extra.join(", "))
 return {bomRows:bom.length,cplRows:cpl.length,bomReferences:bRefs.length,cplReferences:cRefs.length,referenceParity:!blockers.length,bomNormalized,cplNormalized,blockers,warnings}
}
export function csvString(headers,rows){
 const cell=v=>'"'+String(v??"").replaceAll('"','""')+'"'
 return [headers,...rows.map(r=>headers.map(h=>r[h]))].map(r=>r.map(cell).join(",")).join("\r\n")+"\r\n"
}
async function rawCli(exe,args,{timeout=240000,maxBuffer=128*1024*1024}={}){return await execFileAsync(exe,args,{encoding:"utf8",windowsHide:true,timeout,maxBuffer})}
export async function runCli(exe,args,opts={}){const {stdout}=await rawCli(exe,args,opts);return parseEnvelope(stdout)}
async function invoke(exe,session,code,args={},timeout=180000){return await runCli(exe,["invoke","--session",session,"--ext-uuid","eda","--code",code,"--args",JSON.stringify(args),"--timeout",String(timeout)],{timeout:timeout+20000,maxBuffer:192*1024*1024})}
export async function detectCli(exe){const [help,doctor]=await Promise.all([rawCli(exe,["--help"],{timeout:15000}),runCli(exe,["doctor"],{timeout:15000})]);const version=parseVersion(help.stdout+"\n"+help.stderr);return {version:version?version.map(x=>x===null?"x":x).join("."):null,versionSupported:versionAtLeast(version,[4,1,60],true),doctor}}
async function projectRoot(exe){
 const candidates=[
  path.join(os.homedir(),"Documents","EasyEDA-Pro","config.json"),
  path.join(os.homedir(),"Documents","LCEDA-Pro","config.json"),
  path.join(os.homedir(),"Documents","JLCEDA-Pro","config.json")
 ]
 for(const configPath of candidates){
  try{
   const config=JSON.parse(await readFile(configPath,"utf8"))
   for(const p of config.APP_PROJECT_DIR??[]){
    if(typeof p==="string"&&p.length){await mkdir(p,{recursive:true});await access(p);return p}
   }
  }catch{}
 }
 const opened=await runCli(exe,["open","--headless","true"]),session=opened.sessionId
 if(!session)throw new Error("Could not open EasyEDA Pro headless session")
 try{
  const paths=await invoke(exe,session,"return await eda.sys_FileSystem.getProjectsPaths();")
  for(const p of Array.isArray(paths)?paths:[]){
   if(typeof p==="string"&&p.length){await mkdir(p,{recursive:true});await access(p);return p}
  }
 }catch{}
 finally{try{await runCli(exe,["session","close","--session",session,"--destroy"],{timeout:30000})}catch{}}
 throw new Error("No EasyEDA Pro project directory found. Check Documents/EasyEDA-Pro or Documents/LCEDA-Pro config.json and APP_PROJECT_DIR.")
}

export async function importProject(exe,zipBytes){const engine=await detectCli(exe);if(!engine.versionSupported)throw new Error("EasyEDA Pro desktop CLI 4.1.60 or newer is required; detected "+(engine.version??"unknown"));const info=validateProjectFiles(unzipSync(zipBytes)),root=await projectRoot(exe),workspace=path.join(root,"PCBWorkbenchSessions",randomUUID()),projectDir=path.join(workspace,info.projectName);let sessionId=null;await mkdir(projectDir,{recursive:true});try{for(const [name,data] of Object.entries(info.entries)){const target=path.resolve(projectDir,name);if(!target.startsWith(projectDir+path.sep))throw new Error("Unsafe target path");await mkdir(path.dirname(target),{recursive:true});await writeFile(target,data,{flag:"wx"})}const projectPath=path.join(projectDir,info.projectFile),opened=await runCli(exe,["open","--path",projectPath,"--headless","true"]);sessionId=opened.sessionId;if(!sessionId)throw new Error("EasyEDA Pro did not return a project session");const inspect=await invoke(exe,sessionId,"const boards=await eda.dmt_Board.getAllBoardsInfo(); const pages=await eda.dmt_Schematic.getAllSchematicPagesInfo(); return {version:eda.sys_Environment.getEditorCurrentVersion(),isClient:eda.sys_Environment.isClient(),isHalfOfflineMode:eda.sys_Environment.isHalfOfflineMode(),project:await eda.dmt_Project.getCurrentProjectInfo(),boards:boards.map(b=>({name:b.name,uuid:b.uuid,pcbUuid:b.pcb?.uuid??null,schematicUuid:b.schematic?.uuid??null})),pages:pages.map(p=>({name:p.name,uuid:p.uuid,parentSchematicUuid:p.parentSchematicUuid}))};");if(inspect.isClient!==true)throw new Error('EasyEDA Pro runtime is not the desktop client');const runtimeVersion=parseVersion('EasyEDA Pro '+inspect.version);if(!versionAtLeast(runtimeVersion,[4,1,60]))throw new Error('EasyEDA Pro desktop 4.1.60 or newer is required; runtime reports '+inspect.version);if(!inspect.boards?.length)throw new Error("EasyEDA opened the project but found no boards");const sourceHashes=await hashProjectDir(projectDir);return {sessionId,projectName:info.projectName,projectPath,workspace,engineVersion:inspect.version,boards:inspect.boards,pages:inspect.pages,sourceFiles:Object.keys(info.entries).length,sourcePaths:Object.keys(info.entries),sourceBytes:Object.values(info.entries).reduce((n,b)=>n+b.byteLength,0),sourceHashes}}catch(e){if(sessionId){try{await runCli(exe,["session","close","--session",sessionId,"--destroy"],{timeout:30000})}catch{}}await rm(workspace,{recursive:true,force:true});throw e}}
export async function writeProjectFiles(zipBytes,active){
 const info=validateProjectFiles(unzipSync(zipBytes))
 if(info.projectName!==active.projectName)throw new Error("Project name mismatch")
 const before=new Set(active.sourcePaths??[]),after=new Set(Object.keys(info.entries))
 if(before.size!==after.size||[...before].some(x=>!after.has(x)))throw new Error("Patch changed the native project file set")
 const projectDir=path.dirname(active.projectPath),updated=[]
 for(const [name,data] of Object.entries(info.entries)){
  const target=path.resolve(projectDir,name)
  if(!target.startsWith(projectDir+path.sep))throw new Error("Unsafe update path")
  let same=false
  try{const existing=await readFile(target);same=existing.equals(Buffer.from(data))}catch{}
  if(!same){await writeFile(target,data);updated.push(name)}
 }
 const sourceHashes=await hashProjectDir(projectDir)
 active.sourceHashes=sourceHashes
 active.lastVerification=null
 return {updatedFiles:updated,sourceHashes,projectDir}
}
export async function updateProject(exe,zipBytes,active){
 const result=await writeProjectFiles(zipBytes,active)
 if(result.updatedFiles.length){
  const oldSession=active.sessionId
  active.sessionId=null
  if(oldSession){try{await closeProject(exe,oldSession)}catch{}}
  const opened=await runCli(exe,["open","--path",active.projectPath,"--headless","true"])
  if(!opened.sessionId)throw new Error("Edited project was saved but EasyEDA Pro did not reopen the updated project")
  active.sessionId=opened.sessionId
  try{
   const inspect=await invoke(exe,active.sessionId,"const boards=await eda.dmt_Board.getAllBoardsInfo(); return {version:eda.sys_Environment.getEditorCurrentVersion(),isClient:eda.sys_Environment.isClient(),boards:boards.map(b=>({name:b.name,uuid:b.uuid,pcbUuid:b.pcb?.uuid??null,schematicUuid:b.schematic?.uuid??null}))};")
   if(inspect.isClient!==true||!inspect.boards?.length)throw new Error("Reopened project is not available in the EasyEDA Pro desktop runtime")
   active.engineVersion=inspect.version
   active.boards=inspect.boards
  }catch(e){
   try{await closeProject(exe,active.sessionId)}catch{}
   active.sessionId=null
   throw e
  }
 }
 return {...result,sessionReopened:result.updatedFiles.length>0,engineVersion:active.engineVersion,boards:active.boards,verificationInvalidated:true}
}
export async function closeProject(exe,sessionId){if(!sessionId)return false;await runCli(exe,["session","close","--session",sessionId,"--destroy"],{timeout:30000});return true}
export async function verifyBoard(exe,sessionId,boardName){
 const code=[
 "const args=__CLI__.args;",
 "const boards=await eda.dmt_Board.getAllBoardsInfo(); const b=boards.find(x=>x.name===args.boardName);",
 "if(!b||!b.pcb?.uuid)throw new Error('Board or PCB UUID not found');",
 "const pcbTab=await eda.dmt_EditorControl.openDocument(b.pcb.uuid); if(!pcbTab)throw new Error('Could not open PCB');",
 "await eda.pcb_Document.save(); await new Promise(r=>setTimeout(r,8000));",
 "let pcbVerbose=null,pcbVerboseError=null; try{pcbVerbose=await eda.pcb_Drc.check(true,false,true);}catch(e){pcbVerboseError=String(e);}",
 "const pcbPassed=await eda.pcb_Drc.check(true,false,false);",
 "const pages=await eda.dmt_Schematic.getAllSchematicPagesInfo(); const targetPages=pages.filter(p=>p.parentSchematicUuid===b.schematic?.uuid); const schematic=[];",
 "for(const page of targetPages){const tab=await eda.dmt_EditorControl.openDocument(page.uuid);if(!tab){schematic.push({name:page.name,uuid:page.uuid,passed:false,error:'Could not open schematic page'});continue;}await eda.sch_Document.save();await new Promise(r=>setTimeout(r,8000));let verbose=null,verboseError=null;try{verbose=await eda.sch_Drc.check(true,false,true);}catch(e){verboseError=String(e);}try{const passed=await eda.sch_Drc.check(true,false,false);schematic.push({name:page.name,uuid:page.uuid,passed:passed===true,verbose,verboseError});}catch(e){schematic.push({name:page.name,uuid:page.uuid,passed:false,error:String(e),verbose,verboseError});}}",
 "return {board:{name:b.name,uuid:b.uuid,pcbUuid:b.pcb.uuid,schematicUuid:b.schematic?.uuid??null},pcb:{passed:pcbPassed===true,booleanResult:pcbPassed,verbose:pcbVerbose,verboseError:pcbVerboseError},schematics:schematic,schematicPassed:targetPages.length>0&&schematic.length===targetPages.length&&schematic.every(x=>x.passed),checkedAt:new Date().toISOString(),engineVersion:eda.sys_Environment.getEditorCurrentVersion()};"
 ].join("\n");
 return await invoke(exe,sessionId,code,{boardName},360000)
}
export async function exportBoard(exe,sessionId,boardName,verification,sourcePath){
 const code=[
 "const args=__CLI__.args; const boards=await eda.dmt_Board.getAllBoardsInfo(); const b=boards.find(x=>x.name===args.boardName); if(!b||!b.pcb?.uuid)throw new Error('Board or PCB UUID not found');",
 "const pages=await eda.dmt_Schematic.getAllSchematicPagesInfo(); const page=pages.find(p=>p.parentSchematicUuid===b.schematic?.uuid); if(!page)throw new Error('No schematic page found for board');",
 "const schTab=await eda.dmt_EditorControl.openDocument(page.uuid); if(!schTab)throw new Error('Could not open schematic'); await new Promise(r=>setTimeout(r,1000));",
 "const bom=await eda.sch_ManufactureData.getBomFile('PCB_Workbench_BOM','csv');",
 "let netlist=null,netlistError=null;try{netlist=await eda.sch_ManufactureData.getNetlistFile('PCB_Workbench_Netlist','Protel2');}catch(e){netlistError=String(e);}",
 "const pcbTab=await eda.dmt_EditorControl.openDocument(b.pcb.uuid); if(!pcbTab)throw new Error('Could not open PCB'); await new Promise(r=>setTimeout(r,2000));",
 "const toB64=async f=>{if(!f)throw new Error('Export API returned undefined');const a=new Uint8Array(await f.arrayBuffer());let s='';for(let i=0;i<a.length;i+=0x8000)s+=String.fromCharCode(...a.subarray(i,i+0x8000));return {name:f.name,size:a.length,b64:btoa(s)};};",
 "const gerber=await eda.pcb_ManufactureData.getGerberFile('PCB_Workbench_Gerber');",
 "const cpl=await eda.pcb_ManufactureData.getPickAndPlaceFile('PCB_Workbench_CPL','csv',ESYS_Unit.MILLIMETER);",
 "let step=null,stepError=null;try{step=await eda.pcb_ManufactureData.get3DFile('PCB_Workbench_Board','step',['Component Model'],'Outfit',true);}catch(e){stepError=String(e);}",
 "return {boardName:b.name,engineVersion:eda.sys_Environment.getEditorCurrentVersion(),files:{gerber:await toB64(gerber),bom:await toB64(bom),cpl:await toB64(cpl),step:step?await toB64(step):null,netlist:netlist?await toB64(netlist):null},optionalErrors:{step:stepError,netlist:netlistError}};"
 ].join("\n");
 const result=await invoke(exe,sessionId,code,{boardName},360000),files=Object.create(null);
 for(const [key,value] of Object.entries(result.files??{})){
  if(!value)continue;
  const data=Buffer.from(value.b64,"base64");
  if(data.length!==value.size||!data.length)throw new Error("Export size mismatch: "+key);
  files[({gerber:"Gerber.zip",bom:"BOM.csv",cpl:"CPL.csv",step:"Board.step",netlist:"Netlist.net"})[key]]=new Uint8Array(data)
 }
 for(const required of ["Gerber.zip","BOM.csv","CPL.csv"])if(!files[required])throw new Error("Required native export missing: "+required);
 const blockers=[],warnings=[];
 if(!verification?.pcb?.passed)blockers.push("Fresh PCB DRC did not pass.");
 if(!verification?.schematicPassed)blockers.push("One or more schematic DRC checks did not pass.");
 const parity=checkBomCpl(new TextDecoder().decode(files["BOM.csv"]),new TextDecoder().decode(files["CPL.csv"]));
 blockers.push(...parity.blockers);warnings.push(...parity.warnings);
 files["BOM.csv"]=new TextEncoder().encode(csvString(["Comment","Designator","Footprint","LCSC Part #","Quantity"],parity.bomNormalized));
 files["CPL.csv"]=new TextEncoder().encode(csvString(["Designator","Mid X","Mid Y","Layer","Rotation"],parity.cplNormalized));
 const gerberEntries=unzipSync(files["Gerber.zip"]);
 const gerberFiles=Object.keys(gerberEntries).filter(name=>gerberEntries[name]?.length>0);
 if(!gerberFiles.length)blockers.push("Gerber archive is empty.");
 const names=gerberFiles.map(x=>x.toUpperCase());
 const has=suffixes=>names.some(name=>suffixes.some(suffix=>name.endsWith(suffix)));
 for(const [label,suffixes] of [["top copper",[".GTL"]],["bottom copper",[".GBL"]],["top solder mask",[".GTS"]],["bottom solder mask",[".GBS"]],["board outline",[".GKO"]],["plated drill",[".DRL"]]]){
  if(!has(suffixes))blockers.push("Missing Gerber layer/file: "+label)
 }
 if(parity.cplNormalized.some(row=>row.SMD==="Yes"&&row.Layer==="Top")&&!has([".GTP"]))blockers.push("Top-side SMD parts exist but top paste Gerber is missing.");
 if(parity.cplNormalized.some(row=>row.SMD==="Yes"&&row.Layer==="Bottom")&&!has([".GBP",".GBB"]))blockers.push("Bottom-side SMD parts exist but bottom paste Gerber is missing.");
 warnings.push("EasyEDA Pro manufacturing-data APIs are beta preview APIs; validate the exported files independently.");
 warnings.push("JLCPCB stock, exact assembly eligibility, through-hole process, component-side orientation and final upload preview have not been confirmed.");
 warnings.push("Physical fit, electrical, thermal and safety validation remain the engineer's responsibility.");
 const sourceHashes=await hashProjectDir(path.dirname(sourcePath));
 const sourceStable=sourceHashes.sourceRevision===verification?.sourceHashes?.sourceRevision;
 if(!sourceStable)blockers.push("Native project changed after the DRC verification.");
 const manifest={schema:"pcb-workbench-native-export/v1",projectPath:sourcePath,boardName,sourceHashes,sourceStable,engine:"EasyEDA Pro desktop CLI",engineVersion:result.engineVersion,generatedAt:new Date().toISOString(),verification,parity,gerberFiles,optionalErrors:result.optionalErrors,blockers,warnings,orderReady:false,status:blockers.length?"BLOCKED":"REVIEW_ONLY"};
 files["REVIEW_ONLY.json"]=new TextEncoder().encode(JSON.stringify(manifest,null,2));
 files["DO_NOT_ORDER.txt"]=new TextEncoder().encode("REVIEW ONLY — NOT APPROVED FOR ORDER.\\nConfirm JLCPCB stock and assembly eligibility, BOM/CPL orientation, all DRC/physical checks and JLCPCB upload preview before ordering.\\n");
 return {files,manifest,zip:zipSync(files,{level:6})}
}
