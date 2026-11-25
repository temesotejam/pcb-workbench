import { zipSync, unzipSync } from "fflate"
import path from "node:path"
import os from "node:os"
import { readFile, writeFile, mkdir, mkdtemp, access } from "node:fs/promises"
import { createHash } from "node:crypto"
import { checkBomCpl, csvString, validateProjectFiles, hashProjectDir } from "./engine.mjs"
import { records } from "../library/native-patch.mjs"

const ports=Array.from({length:10},(_,i)=>49620+i)
export function parseBridgeEnvelope(data){if(data?.success===false||data?.ok===false)throw new Error(data.error?.message??data.error??data.message??'Bridge execution failed');return data?.result??data?.value??data?.data??data}
export function normalizeWindows(data){return Array.isArray(data)?data:data?.windows??data?.result?.windows??[]}
export function bridgeHealthMatches(data){return data?.service==='easyeda-bridge'&&data?.edaConnected===true}
const json=async r=>{const t=await r.text();try{return JSON.parse(t)}catch{throw new Error("EasyEDA Bridge returned invalid JSON: "+t.slice(0,400))}}
async function request(port,path,options={}){
 const response=await fetch("http://127.0.0.1:"+port+path,{...options,signal:AbortSignal.timeout(options.timeout??4000)})
 const data=await json(response)
 if(!response.ok||data.success===false||data.ok===false)throw new Error(data.error?.message??data.error??data.message??("Bridge HTTP "+response.status))
 return data
}
export async function discoverBridge(){
 const errors=[]
 for(const port of ports){
  try{
   const health=await request(port,"/health")
   if(bridgeHealthMatches(health))return {port,health}
  }catch(e){errors.push(port+": "+e.message)}
 }
 throw new Error("EasyEDA Pro Bridge Server was not found on ports 49620–49629. Start the installed EasyEDA API Gateway / Bridge Server first.")
}
export async function bridgeWindows(port){
 const data=await request(port,"/eda-windows")
 const windows=normalizeWindows(data)
 return {windows,activeWindowId:data.activeWindowId??data.activeWindow?.id??null}
}
export async function selectBridgeWindow(port,windowId){
 return await request(port,"/eda-windows/select",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({windowId})})
}
export async function bridgeExecute(port,windowId,code,timeout=120000){
 const data=await request(port,"/execute",{method:"POST",timeout,headers:{"Content-Type":"application/json"},body:JSON.stringify({code,windowId})})
 let result=parseBridgeEnvelope(data)
 if(typeof result==="string"){try{result=JSON.parse(result)}catch{}}
 return result
}
export async function inspectCurrentProject(port,windowId){
 const code=[
 "const project=await eda.dmt_Project.getCurrentProjectInfo();",
 "const boards=await eda.dmt_Board.getAllBoardsInfo();",
 "const pages=await eda.dmt_Schematic.getAllSchematicPagesInfo();",
 "let projectPaths=null;try{projectPaths=await eda.sys_FileSystem.getProjectsPaths();}catch(e){}",
 "return {project,boards:boards.map(b=>({name:b.name,uuid:b.uuid,pcbUuid:b.pcb?.uuid??null,schematicUuid:b.schematic?.uuid??null})),pages:pages.map(p=>({name:p.name,uuid:p.uuid,parentSchematicUuid:p.parentSchematicUuid})),projectPaths,engineVersion:eda.sys_Environment.getEditorCurrentVersion(),isClient:eda.sys_Environment.isClient()};"
 ].join("\n")
 const result=await bridgeExecute(port,windowId,code)
 if(!result?.boards?.length)throw new Error("No PCB board is open in the connected EasyEDA Pro window")
 if(result.isClient!==true)throw new Error("Connected EDA window is not the EasyEDA Pro desktop client")
 if(!Array.isArray(result.projectPaths)||!result.projectPaths.length){
  for(const configPath of [path.join(os.homedir(),"Documents","EasyEDA-Pro","config.json"),path.join(os.homedir(),"Documents","LCEDA-Pro","config.json")]){
   try{const config=JSON.parse(await readFile(configPath,"utf8"));if(Array.isArray(config.APP_PROJECT_DIR)){result.projectPaths=config.APP_PROJECT_DIR;break}}catch{}
  }
 }
 result.projectDir=null
 if(result.project?.name&&Array.isArray(result.projectPaths)){
  for(const root of result.projectPaths){
   const candidate=path.resolve(root,result.project.name)
   try{await access(path.join(candidate,result.project.name+".eprj3"));result.projectDir=candidate;break}catch{}
  }
 }
 return result
}
export async function bridgeVerifyBoard(port,windowId,boardName){
 const code=[
 "const args="+JSON.stringify({boardName})+";",
 "const boards=await eda.dmt_Board.getAllBoardsInfo();const b=boards.find(x=>x.name===args.boardName);",
 "if(!b||!b.pcb?.uuid)throw new Error('Board or PCB UUID not found: '+args.boardName);",
"const classifyDrcItems="+classifyDrcItems.toString()+";",
 "const pcbTab=await eda.dmt_EditorControl.openDocument(b.pcb.uuid);if(!pcbTab)throw new Error('Could not open PCB document');",
 "await eda.pcb_Document.save();await new Promise(r=>setTimeout(r,8000));",
 "let pcbVerbose=null,pcbVerboseError=null,pcbDetailAvailable=false;try{pcbVerbose=await eda.pcb_Drc.check(true,false,true);pcbDetailAvailable=Array.isArray(pcbVerbose);}catch(e){pcbVerboseError=String(e);}",
 "let pcbStrict=false;try{pcbStrict=await eda.pcb_Drc.check(true,false,false)===true;}catch(e){if(!pcbVerboseError)pcbVerboseError=String(e);}",
 "const pcbClass=classifyDrcItems(pcbVerbose,'errorType');const pcbPassed=pcbDetailAvailable?(pcbClass.errors.length===0&&pcbClass.unknown.length===0):pcbStrict;",
 "const pages=await eda.dmt_Schematic.getAllSchematicPagesInfo();const target=pages.filter(p=>p.parentSchematicUuid===b.schematic?.uuid);const schematic=[];",
 "for(const page of target){const tab=await eda.dmt_EditorControl.openDocument(page.uuid);if(!tab){schematic.push({name:page.name,uuid:page.uuid,passed:false,detailAvailable:false,error:'Could not open page'});continue;}await eda.sch_Document.save();await new Promise(r=>setTimeout(r,8000));let verbose=null,verboseError=null,detailAvailable=false;try{verbose=await eda.sch_Drc.check(true,false,true);detailAvailable=Array.isArray(verbose);}catch(e){verboseError=String(e);}let strictPassed=false;try{strictPassed=await eda.sch_Drc.check(true,false,false)===true;}catch(e){if(!verboseError)verboseError=String(e);}const cls=classifyDrcItems(verbose,'type');const passed=detailAvailable?(cls.errors.length===0&&cls.unknown.length===0):strictPassed;schematic.push({name:page.name,uuid:page.uuid,passed,strictPassed,detailAvailable,errors:cls.errors,warnings:cls.warnings,unknown:cls.unknown,verboseError});}",
 "const errorCount=pcbClass.errors.length+pcbClass.unknown.length+schematic.reduce((n,x)=>n+x.errors.length+x.unknown.length,0);const warningCount=pcbClass.warnings.length+schematic.reduce((n,x)=>n+x.warnings.length,0);const unknownCount=pcbClass.unknown.length+schematic.reduce((n,x)=>n+x.unknown.length,0);",
 "return {board:{name:b.name,uuid:b.uuid,pcbUuid:b.pcb.uuid,schematicUuid:b.schematic?.uuid??null},pcb:{passed:pcbPassed,strictPassed:pcbStrict,detailAvailable:pcbDetailAvailable,errors:pcbClass.errors,warnings:pcbClass.warnings,unknown:pcbClass.unknown,verboseError:pcbVerboseError},schematics:schematic,schematicPassed:target.length>0&&schematic.length===target.length&&schematic.every(x=>x.passed),errorCount,warningCount,unknownCount,checkedAt:new Date().toISOString(),engineVersion:eda.sys_Environment.getEditorCurrentVersion()};"
 ].join("\n")
 return await bridgeExecute(port,windowId,code,120000)
}
async function exportFiles(port,windowId,boardName){
 const code=[
 "const args="+JSON.stringify({boardName})+";",
 "const boards=await eda.dmt_Board.getAllBoardsInfo();const b=boards.find(x=>x.name===args.boardName);if(!b||!b.pcb?.uuid)throw new Error('Board or PCB UUID not found');",
 "const pages=await eda.dmt_Schematic.getAllSchematicPagesInfo();const page=pages.find(p=>p.parentSchematicUuid===b.schematic?.uuid);if(!page)throw new Error('No schematic page found');",
 "const schTab=await eda.dmt_EditorControl.openDocument(page.uuid);if(!schTab)throw new Error('Could not open schematic');await new Promise(r=>setTimeout(r,700));",
 "const bom=await eda.sch_ManufactureData.getBomFile('PCB_Workbench_BOM','csv');let netlist=null,netlistError=null;try{netlist=await eda.sch_ManufactureData.getNetlistFile('PCB_Workbench_Netlist','Protel2');}catch(e){netlistError=String(e);}",
 "const pcbTab=await eda.dmt_EditorControl.openDocument(b.pcb.uuid);if(!pcbTab)throw new Error('Could not open PCB');await new Promise(r=>setTimeout(r,700));",
 "const toB64=async f=>{if(!f)throw new Error('Export API returned undefined');const a=new Uint8Array(await f.arrayBuffer());let s='';for(let i=0;i<a.length;i+=0x8000)s+=String.fromCharCode(...a.subarray(i,i+0x8000));return {name:f.name,size:a.length,b64:btoa(s)};};",
 "const gerber=await eda.pcb_ManufactureData.getGerberFile('PCB_Workbench_Gerber');",
 "const cpl=await eda.pcb_ManufactureData.getPickAndPlaceFile('PCB_Workbench_CPL','csv',ESYS_Unit.MILLIMETER);",
 "let step=null,stepError=null;try{step=await eda.pcb_ManufactureData.get3DFile('PCB_Workbench_Board','step',['Component Model'],'Outfit',true);}catch(e){stepError=String(e);}",
 "return {boardName:b.name,engineVersion:eda.sys_Environment.getEditorCurrentVersion(),files:{gerber:await toB64(gerber),bom:await toB64(bom),cpl:await toB64(cpl),step:step?await toB64(step):null,netlist:netlist?await toB64(netlist):null},optionalErrors:{step:stepError,netlist:netlistError}};"
 ].join("\n")
 return await bridgeExecute(port,windowId,code,120000)
}
export function classifyDrcItems(items,severityField="type"){
 const result={errors:[],warnings:[],unknown:[],info:[]}
 if(!Array.isArray(items)){result.unknown.push({value:items,reason:"DRC details were not an array"});return result}
 for(const item of items){
  const level=String(item?.[severityField]??item?.type??item?.errorType??"").toLowerCase()
  if(level==="error"||level==="fatalerror")result.errors.push(item)
  else if(level==="warn"||level==="warning")result.warnings.push(item)
  else if(level==="info"||level==="information")result.info.push(item)
  else result.unknown.push(item)
 }
 return result
}
export function expectedAssemblySideProfile(projectName){
 if(projectName==="NUCLEO-F401RE Rev1.5")return {CN7:"Bottom",CN10:"Bottom"}
 if(projectName==="NUCLEO-F401RE Lower GPIO Proto R1")return {CN7:"Top",CN10:"Top"}
 return {}
}
export function buildJlcpcbReviewBundle(input,{verification,projectName=null,boardName,engineVersion,optionalErrors={},sourceRevision=null,sourceFileHashes=null}={}){
 const files={...input},blockers=[],warnings=[]
 if(!sourceRevision)blockers.push("Native source revision could not be captured; this export is not bound to a verified project snapshot.")
 for(const required of ["Gerber.zip","BOM.csv","CPL.csv"])if(!files[required]?.length)throw new Error("Required native export missing: "+required)
 if(!verification?.pcb?.passed)blockers.push("PCB DRC contains errors, unknown violations or an unavailable detailed result.")
 if(!verification?.schematicPassed)blockers.push("Schematic ERC/DRC contains errors, unknown violations or an unavailable detailed result.")
 for(const item of verification?.pcb?.warnings??[])warnings.push("PCB warning: "+(item.ruleName??item.rule??item.explanation??JSON.stringify(item)))
 for(const page of verification?.schematics??[])for(const item of page.warnings??[])warnings.push("Schematic "+page.name+" warning: "+(item.rule??item.type??item.message??JSON.stringify(item)))
 const expectedSideByRef=expectedAssemblySideProfile(projectName)
 if(!Object.keys(expectedSideByRef).length)warnings.push("No board-specific assembly-side profile is registered for project "+String(projectName??"(unknown)")+".")
 const parity=checkBomCpl(new TextDecoder().decode(files["BOM.csv"]),new TextDecoder().decode(files["CPL.csv"]),{expectedSideByRef})
 blockers.push(...parity.blockers);warnings.push(...parity.warnings)
 files["BOM.csv"]=new TextEncoder().encode(csvString(["Comment","Designator","Footprint","LCSC Part #","Quantity"],parity.bomNormalized))
 files["CPL.csv"]=new TextEncoder().encode(csvString(["Designator","Mid X","Mid Y","Layer","Rotation"],parity.cplNormalized))
 const gerberEntries=unzipSync(files["Gerber.zip"]),gerberFiles=Object.keys(gerberEntries).filter(name=>gerberEntries[name]?.length>0)
 const names=gerberFiles.map(x=>x.toUpperCase()),has=suffixes=>names.some(name=>suffixes.some(suffix=>name.endsWith(suffix)))
 if(!gerberFiles.length)blockers.push("Gerber archive is empty.")
 const folded=gerberFiles.map(x=>x.toLowerCase())
 if(new Set(folded).size!==folded.length)blockers.push("Gerber archive contains duplicate case-insensitive filenames.")
 for(const name of gerberFiles)if(name.startsWith("/")||name.includes("\\")||name.split("/").some(part=>part===".."||part==="."))blockers.push("Unsafe Gerber archive path: "+name)
 for(const [label,suffix] of [["top copper",".GTL"],["bottom copper",".GBL"],["top solder mask",".GTS"],["bottom solder mask",".GBS"],["board outline",".GKO"],["plated drill",".DRL"]])if(!has([suffix]))blockers.push("Missing Gerber layer/file: "+label)
 if(parity.cplNormalized.some(x=>x.SMD==="Yes"&&x.Layer==="Top")&&!has([".GTP"]))blockers.push("Top-side SMD parts exist but top paste Gerber is missing.")
 if(parity.cplNormalized.some(x=>x.SMD==="Yes"&&x.Layer==="Bottom")&&!has([".GBP",".GBB"]))blockers.push("Bottom-side SMD parts exist but bottom paste Gerber is missing.")
 warnings.push("EasyEDA Pro manufacture-data APIs are beta preview APIs; validate exported files independently.")
 warnings.push("JLCPCB stock, exact assembly eligibility, THT process, component-side orientation and final upload preview have not been confirmed.")
 warnings.push("Physical fit, electrical, thermal and safety validation remain the engineer's responsibility.")
 if(!files["Board.step"])warnings.push("STEP export is unavailable; mechanical 3D review must use the native CAD project.")
 if(!files["Netlist.net"])warnings.push("Native schematic netlist export is unavailable; electrical connectivity parity remains unverified.")
 files["DO_NOT_ORDER.txt"]=new TextEncoder().encode("REVIEW ONLY — NOT APPROVED FOR ORDER.\nConfirm JLCPCB stock and assembly eligibility, BOM/CPL orientation, netlist parity, all DRC/physical checks and JLCPCB upload preview before ordering.\n")
 files["JLCPCB_UPLOAD_GUIDE.txt"]=new TextEncoder().encode("JLCPCB REVIEW PACKAGE\n\n1. Upload Gerber.zip in the PCB order page and inspect every parsed layer and board outline.\n2. For PCBA, upload BOM.csv and CPL.csv separately in the assembly page.\n3. Confirm every LCSC part number, MPN, footprint, stock, assembly class and quantity.\n4. Inspect top/bottom side, rotation and connector orientation in the placement preview.\n5. Review REVIEW_ONLY.json and resolve every blocker and warning.\n6. This bundle is not order-approved. DO_NOT_ORDER.txt remains in force until engineering and factory preview checks pass.\n")
 const outputHashes=Object.fromEntries(Object.entries(files).map(([name,data])=>[name,createHash("sha256").update(data).digest("hex")]))
 const manifest={schema:"pcb-workbench-bridge-export/v1",projectName,boardName,expectedSideByRef,sourceRevision,sourceFileHashes,engine:"EasyEDA Pro API Gateway / Bridge Server",engineVersion,generatedAt:new Date().toISOString(),verification,parity,gerberFiles,outputHashes,optionalErrors,blockers,warnings,orderReady:false,status:blockers.length?"BLOCKED":"REVIEW_ONLY"}
 files["REVIEW_ONLY.json"]=new TextEncoder().encode(JSON.stringify(manifest,null,2))
 return {files,manifest,zip:zipSync(files,{level:6}),verification}
}
export async function bridgeExportBoard(port,windowId,boardName,projectName=null,projectDir=null){
 const verification=await bridgeVerifyBoard(port,windowId,boardName)
 const sourceBefore=projectDir?await hashProjectDir(projectDir):null
 const result=await exportFiles(port,windowId,boardName)
 const sourceAfter=projectDir?await hashProjectDir(projectDir):null
 if(sourceBefore&&sourceAfter&&sourceBefore.sourceRevision!==sourceAfter.sourceRevision)throw new Error("Native project changed during manufacturing export; discard this bundle and export again from a saved revision.")
 const files=Object.create(null)
 for(const [key,value] of Object.entries(result.files??{})){
  if(!value)continue
  const data=Buffer.from(value.b64,"base64")
  if(data.length!==value.size||!data.length)throw new Error("Export size mismatch: "+key)
  const name=({gerber:"Gerber.zip",bom:"BOM.csv",cpl:"CPL.csv",step:"Board.step",netlist:"Netlist.net"})[key]
  if(!name)throw new Error("Unknown manufacturing export type: "+key)
  files[name]=new Uint8Array(data)
 }
 return buildJlcpcbReviewBundle(files,{verification,projectName,boardName,engineVersion:result.engineVersion,optionalErrors:result.optionalErrors,sourceRevision:sourceAfter?.sourceRevision??null,sourceFileHashes:sourceAfter?.hashes??null})
}

export function nativeDocumentCounts(entries){
 const result=[]
 for(const [file,bytes] of Object.entries(entries)){
  if(!/\.(epcb2|esch2)$/i.test(file))continue
  const parsed=records(bytes),doc=parsed.items.find(x=>x.doc)?.doc
  if(!doc?.uuid||!doc?.type)throw new Error("Native document header missing: "+file)
  result.push({file,docType:doc.type,uuid:doc.uuid,componentCount:parsed.items.filter(x=>x.doc?.uuid===doc.uuid&&x.h.type==="COMPONENT").length,wireCount:parsed.items.filter(x=>x.doc?.uuid===doc.uuid&&x.h.type==="WIRE").length})
 }
 return result
}
export function validateNativePatchTarget(projectDir,projectPaths,info,baseHashes){
 if(!projectDir)throw new Error("The active EasyEDA project folder could not be resolved; native editing is disabled.")
 const dir=path.resolve(projectDir),roots=(projectPaths??[]).map(x=>path.resolve(x))
 if(!roots.some(root=>dir.startsWith(root+path.sep)))throw new Error("Project folder is outside EasyEDA's configured project directories.")
 if(path.basename(dir)!==info.projectName)throw new Error("Patch project name does not match the active EasyEDA project.")
 const names=Object.keys(info.entries).sort()
 if(!baseHashes||typeof baseHashes!=="object"||JSON.stringify(Object.keys(baseHashes).sort())!==JSON.stringify(names))throw new Error("Missing or mismatched base revision hashes.")
 for(const [name,sha] of Object.entries(baseHashes))if(!/^[a-f0-9]{64}$/i.test(sha))throw new Error("Invalid base SHA-256 for "+name)
 return {dir,names}
}
export async function applyNativePatchFiles(projectDir,projectPaths,zipBytes,baseHashes,beforeWrite=async()=>{},afterWrite=null){
 const info=validateProjectFiles(unzipSync(zipBytes))
 const {dir,names}=validateNativePatchTarget(projectDir,projectPaths,info,baseHashes)
 await beforeWrite()
 const original=new Map(),targets=new Map()
 for(const name of names){
  const target=path.resolve(dir,name)
  if(!target.startsWith(dir+path.sep))throw new Error("Unsafe native project path: "+name)
  const old=await readFile(target),digest=createHash("sha256").update(old).digest("hex")
  if(digest.toLowerCase()!==baseHashes[name].toLowerCase())throw new Error("The active EasyEDA file changed since import; refusing to overwrite: "+name)
  original.set(name,old);targets.set(name,target)
 }
 const backupRoot=await mkdtemp(path.join(os.tmpdir(),"pcb-workbench-backup-"))
 for(const [name,data] of original){const backup=path.join(backupRoot,name);await mkdir(path.dirname(backup),{recursive:true});await writeFile(backup,data)}
 const ordered=names.sort((a,b)=>Number(a.toLowerCase().endsWith(".eprj3"))-Number(b.toLowerCase().endsWith(".eprj3")))
 const updated=[]
 try{
  for(const name of ordered){
   const next=Buffer.from(info.entries[name]),old=original.get(name)
   if(old.equals(next))continue
   await writeFile(targets.get(name),next);updated.push(name)
  }
  for(const name of names){
   const actual=await readFile(targets.get(name)),expected=Buffer.from(info.entries[name])
   if(!actual.equals(expected))throw new Error("Read-back verification failed: "+name)
  }
  const runtimeVerification=afterWrite?await afterWrite({projectName:info.projectName,expectedDocuments:nativeDocumentCounts(info.entries),projectDir:dir}):null
  return {updatedFiles:updated,projectDir:dir,backupDir:backupRoot,readBackVerified:true,runtimeVerification,verificationInvalidated:true}
 }catch(error){
  const rollbackErrors=[]
  for(const name of [...updated].reverse()){try{await writeFile(targets.get(name),original.get(name))}catch(e){rollbackErrors.push(name+": "+e.message)}}
  if(rollbackErrors.length)throw new Error("Patch failed and rollback was incomplete. Backup: "+backupRoot+". "+rollbackErrors.join("; "))
  throw new Error("Patch failed; original files were restored. Backup: "+backupRoot+". "+error.message)
 }
}
export async function bridgeApplyNativePatch(port,windowId,projectDir,projectPaths,zipBytes,baseHashes,boardName){
 const saveCode=[
  "const boards=await eda.dmt_Board.getAllBoardsInfo();",
  "for(const b of boards){if(b.pcb?.uuid){const t=await eda.dmt_EditorControl.openDocument(b.pcb.uuid);if(t)await eda.pcb_Document.save();}}",
  "const pages=await eda.dmt_Schematic.getAllSchematicPagesInfo();",
  "for(const p of pages){const t=await eda.dmt_EditorControl.openDocument(p.uuid);if(t)await eda.sch_Document.save();}",
  "await new Promise(r=>setTimeout(r,8000));return {saved:true};"
 ].join("\n")
 const afterWrite=async({expectedDocuments})=>{
  const expectedPcbDocuments=expectedDocuments.filter(x=>x.docType==="PCB")
  const expectedPages=expectedDocuments.filter(x=>x.docType==="SCH_PAGE")
  if(!expectedPcbDocuments.length||!expectedPages.length)throw new Error("Native source package lacks the PCB or schematic page documents required for live verification.")
  const args={boardName,expectedPcbDocuments,expectedPages:expectedPages.map(x=>({uuid:x.uuid,components:x.componentCount,wires:x.wireCount}))}
  const code=[
   "const args="+JSON.stringify(args)+";",
   "const boards=await eda.dmt_Board.getAllBoardsInfo();const b=boards.find(x=>x.name===args.boardName);",
   "if(!b||!b.pcb?.uuid)throw new Error('The active PCB identity is missing.');const expectedPcb=args.expectedPcbDocuments.find(x=>x.uuid===b.pcb.uuid);if(!expectedPcb)throw new Error('The active PCB identity does not match the patched native source.');",
   "await new Promise(r=>setTimeout(r,8000));const pcbTab=await eda.dmt_EditorControl.openDocument(b.pcb.uuid);if(!pcbTab)throw new Error('Could not reopen patched PCB.');",
   "await new Promise(r=>setTimeout(r,1500));const pcbComponents=await eda.pcb_PrimitiveComponent.getAll();",
   "if(pcbComponents.length!==expectedPcb.componentCount)throw new Error('PCB reload component count mismatch: expected '+expectedPcb.componentCount+', got '+pcbComponents.length);",
   "const pages=await eda.dmt_Schematic.getAllSchematicPagesInfo();const linked=pages.filter(p=>p.parentSchematicUuid===b.schematic?.uuid);const expectedByUuid=new Map(args.expectedPages.map(x=>[x.uuid,x]));const linkedExpected=linked.map(p=>expectedByUuid.get(p.uuid)).filter(Boolean);const pageChecks=[];if(!linked.length||linkedExpected.length!==linked.length)throw new Error('Linked schematic pages do not match the native source package.');",
   "for(const expected of linkedExpected){const page=linked.find(p=>p.uuid===expected.uuid);if(!page){pageChecks.push({uuid:expected.uuid,passed:false,error:'Page missing from active schematic'});continue;}const tab=await eda.dmt_EditorControl.openDocument(page.uuid);if(!tab){pageChecks.push({uuid:page.uuid,passed:false,error:'Could not reopen schematic page'});continue;}await new Promise(r=>setTimeout(r,700));const components=await eda.sch_PrimitiveComponent.getAll();const wires=await eda.sch_PrimitiveWire.getAllPrimitiveId();const passed=components.length===expected.components&&wires.length===expected.wires;pageChecks.push({uuid:page.uuid,expectedComponents:expected.components,actualComponents:components.length,expectedWires:expected.wires,actualWires:wires.length,passed});}",
   "const passed=pageChecks.length===linkedExpected.length&&pageChecks.every(x=>x.passed);if(!passed)throw new Error('Schematic reload object-count verification failed: '+JSON.stringify(pageChecks));",
   "return {passed:true,pcb:{expectedComponents:expectedPcb.componentCount,actualComponents:pcbComponents.length},schematics:pageChecks,verifiedAt:new Date().toISOString()};"
  ].join("\n")
  return await bridgeExecute(port,windowId,code,120000)
 }
 try{
  return await applyNativePatchFiles(projectDir,projectPaths,zipBytes,baseHashes,()=>bridgeExecute(port,windowId,saveCode,120000),afterWrite)
 }catch(error){
  try{await bridgeExecute(port,windowId,"await new Promise(r=>setTimeout(r,8000));return {rollbackReloadWaited:true};",30000)}catch{}
  throw error
 }
}
