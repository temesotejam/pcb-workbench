import { zipSync, unzipSync } from "fflate"
import { checkBomCpl, csvString } from "./engine.mjs"

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
export async function bridgeExecute(port,windowId,code){
 const data=await request(port,"/execute",{method:"POST",timeout:30000,headers:{"Content-Type":"application/json"},body:JSON.stringify({code,windowId})})
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
 return result
}
export async function bridgeVerifyBoard(port,windowId,boardName){
 const code=[
 "const args="+JSON.stringify({boardName})+";",
 "const boards=await eda.dmt_Board.getAllBoardsInfo();const b=boards.find(x=>x.name===args.boardName);",
 "if(!b||!b.pcb?.uuid)throw new Error('Board or PCB UUID not found: '+args.boardName);",
 "const pcbTab=await eda.dmt_EditorControl.openDocument(b.pcb.uuid);if(!pcbTab)throw new Error('Could not open PCB document');",
 "await eda.pcb_Document.save();await new Promise(r=>setTimeout(r,1200));",
 "let pcbVerbose=null,pcbVerboseError=null;try{pcbVerbose=await eda.pcb_Drc.check(true,false,true);}catch(e){pcbVerboseError=String(e);}",
 "const pcbPassed=await eda.pcb_Drc.check(true,false,false);",
 "const pages=await eda.dmt_Schematic.getAllSchematicPagesInfo();const target=pages.filter(p=>p.parentSchematicUuid===b.schematic?.uuid);const schematic=[];",
 "for(const page of target){const tab=await eda.dmt_EditorControl.openDocument(page.uuid);if(!tab){schematic.push({name:page.name,uuid:page.uuid,passed:false,error:'Could not open page'});continue;}await eda.sch_Document.save();await new Promise(r=>setTimeout(r,900));let verbose=null,verboseError=null;try{verbose=await eda.sch_Drc.check(true,false,true);}catch(e){verboseError=String(e);}try{const passed=await eda.sch_Drc.check(true,false,false);schematic.push({name:page.name,uuid:page.uuid,passed:passed===true,verbose,verboseError});}catch(e){schematic.push({name:page.name,uuid:page.uuid,passed:false,error:String(e),verbose,verboseError});}}",
 "return {board:{name:b.name,uuid:b.uuid,pcbUuid:b.pcb.uuid,schematicUuid:b.schematic?.uuid??null},pcb:{passed:pcbPassed===true,booleanResult:pcbPassed,verbose,verboseError},schematics:schematic,schematicPassed:target.length>0&&schematic.length===target.length&&schematic.every(x=>x.passed),checkedAt:new Date().toISOString(),engineVersion:eda.sys_Environment.getEditorCurrentVersion()};"
 ].join("\n")
 return await bridgeExecute(port,windowId,code)
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
 return await bridgeExecute(port,windowId,code)
}
export async function bridgeExportBoard(port,windowId,boardName){
 const verification=await bridgeVerifyBoard(port,windowId,boardName)
 const result=await exportFiles(port,windowId,boardName)
 const files=Object.create(null)
 for(const [key,value] of Object.entries(result.files??{})){
  if(!value)continue
  const data=Buffer.from(value.b64,"base64")
  if(data.length!==value.size||!data.length)throw new Error("Export size mismatch: "+key)
  files[({gerber:"Gerber.zip",bom:"BOM.csv",cpl:"CPL.csv",step:"Board.step",netlist:"Netlist.net"})[key]]=new Uint8Array(data)
 }
 for(const required of ["Gerber.zip","BOM.csv","CPL.csv"])if(!files[required])throw new Error("Required native export missing: "+required)
 const blockers=[],warnings=[]
 if(!verification.pcb?.passed)blockers.push("Fresh PCB DRC did not pass.")
 if(!verification.schematicPassed)blockers.push("One or more schematic DRC checks did not pass.")
 const parity=checkBomCpl(new TextDecoder().decode(files["BOM.csv"]),new TextDecoder().decode(files["CPL.csv"]))
 blockers.push(...parity.blockers);warnings.push(...parity.warnings)
 files["BOM.csv"]=new TextEncoder().encode(csvString(["Comment","Designator","Footprint","LCSC Part #","Quantity"],parity.bomNormalized))
 files["CPL.csv"]=new TextEncoder().encode(csvString(["Designator","Mid X","Mid Y","Layer","Rotation"],parity.cplNormalized))
 const gerberEntries=unzipSync(files["Gerber.zip"]),gerberFiles=Object.keys(gerberEntries).filter(name=>gerberEntries[name]?.length>0)
 const names=gerberFiles.map(x=>x.toUpperCase()),has=suffixes=>names.some(name=>suffixes.some(suffix=>name.endsWith(suffix)))
 if(!gerberFiles.length)blockers.push("Gerber archive is empty.")
 for(const [label,suffix] of [["top copper",".GTL"],["bottom copper",".GBL"],["top solder mask",".GTS"],["bottom solder mask",".GBS"],["board outline",".GKO"],["plated drill",".DRL"]])if(!has([suffix]))blockers.push("Missing Gerber layer/file: "+label)
 if(parity.cplNormalized.some(x=>x.SMD==="Yes"&&x.Layer==="Top")&&!has([".GTP"]))blockers.push("Top-side SMD parts exist but top paste Gerber is missing.")
 if(parity.cplNormalized.some(x=>x.SMD==="Yes"&&x.Layer==="Bottom")&&!has([".GBP",".GBB"]))blockers.push("Bottom-side SMD parts exist but bottom paste Gerber is missing.")
 warnings.push("EasyEDA Pro manufacture-data APIs are beta preview APIs; validate exported files independently.")
 warnings.push("JLCPCB stock, exact assembly eligibility, THT process, component-side orientation and final upload preview have not been confirmed.")
 warnings.push("Physical fit, electrical, thermal and safety validation remain the engineer's responsibility.")
 const manifest={schema:"pcb-workbench-bridge-export/v1",boardName,engine:"EasyEDA Pro API Gateway / Bridge Server",engineVersion:result.engineVersion,generatedAt:new Date().toISOString(),verification,parity,gerberFiles,optionalErrors:result.optionalErrors,blockers,warnings,orderReady:false,status:blockers.length?"BLOCKED":"REVIEW_ONLY"}
 files["REVIEW_ONLY.json"]=new TextEncoder().encode(JSON.stringify(manifest,null,2))
 files["DO_NOT_ORDER.txt"]=new TextEncoder().encode("REVIEW ONLY — NOT APPROVED FOR ORDER.\nConfirm JLCPCB stock and assembly eligibility, BOM/CPL orientation, all DRC/physical checks and JLCPCB upload preview before ordering.\n")
 return {files,manifest,zip:zipSync(files,{level:6}),verification}
}
