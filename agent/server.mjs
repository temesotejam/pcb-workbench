import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readFile } from "node:fs/promises"
import { randomBytes } from "node:crypto"
import { build } from "esbuild"
import { discoverBridge, bridgeWindows, selectBridgeWindow, inspectCurrentProject, bridgeVerifyBoard, bridgeExportBoard, bridgeApplyNativePatch } from "./bridge.mjs"
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),".."),site=path.join(root,"site"),port=Number(process.env.PWB_PORT||8787),host="127.0.0.1"
const origins=new Set(["http://127.0.0.1:"+port,"http://localhost:"+port]),token=randomBytes(32).toString("hex")
let bridge=null,active=null
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".svg":"image/svg+xml"}
function send(res,status,data,type="application/json; charset=utf-8"){res.writeHead(status,{"Content-Type":type,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"});res.end(typeof data==="string"?data:JSON.stringify(data))}
async function body(req,max=170*1024*1024){const chunks=[];let n=0;for await(const c of req){n+=c.length;if(n>max)throw new Error("Request body exceeds limit");chunks.push(c)}return Buffer.concat(chunks)}
async function jsonBody(req){return JSON.parse((await body(req,1024*1024)).toString("utf8"))}
function guard(req,res,write=false){if(!["127.0.0.1","localhost"].includes(String(req.headers.host||"").split(":")[0])){send(res,403,{error:"Localhost only"});return false}const origin=req.headers.origin;if(origin&&!origins.has(origin)){send(res,403,{error:"Origin rejected"});return false}if(write&&req.headers["x-pwb-token"]!==token){send(res,403,{error:"Session token rejected"});return false}return true}
async function staticFile(req,res){const u=new URL(req.url,"http://127.0.0.1");let name=decodeURIComponent(u.pathname);if(name==="/")name="/index.html";if(name==="/catalog.json"){const b=await readFile(path.join(root,"library","catalog.json"));return send(res,200,b,"application/json; charset=utf-8")}const target=path.resolve(site,"."+name);if(!target.startsWith(site+path.sep)){send(res,403,{error:"Invalid path"});return}try{const b=await readFile(target);send(res,200,b,mime[path.extname(target)]||"application/octet-stream")}catch{send(res,404,"Not found","text/plain; charset=utf-8")}}
async function getBridge(){if(!bridge)bridge=await discoverBridge();return bridge}
async function start(){
 await build({entryPoints:[path.join(site,"handoff-entry.js")],bundle:true,platform:"browser",format:"esm",target:["es2022"],minify:true,outfile:path.join(site,"handoff.js")})
 const server=http.createServer(async(req,res)=>{
  try{
   if(!guard(req,res,req.url.startsWith("/api/")&&req.method==="POST"))return
   const u=new URL(req.url,"http://127.0.0.1")
   if(u.pathname==="/api/bootstrap"&&req.method==="GET")return send(res,200,{token,localOnly:true})
   if(u.pathname==="/api/health"&&req.method==="POST"){
    bridge=await discoverBridge()
    const windows=await bridgeWindows(bridge.port)
    return send(res,200,{port:bridge.port,health:bridge.health,windows:windows.windows,activeWindowId:windows.activeWindowId,connected:true})
   }
   if(u.pathname==="/api/select-window"&&req.method==="POST"){
    const b=await getBridge(),{windowId}=await jsonBody(req)
    await selectBridgeWindow(b.port,windowId)
    active={port:b.port,windowId,project:null,boards:[],pages:[],lastVerification:null}
    return send(res,200,{selected:true,windowId})
   }
   if(u.pathname==="/api/attach"&&req.method==="POST"){
    const b=await getBridge(),{boardName}=await jsonBody(req)
    const windows=await bridgeWindows(b.port)
    const windowId=active?.windowId??windows.activeWindowId??windows.windows?.[0]?.id??windows.windows?.[0]?.windowId??null
    const project=await inspectCurrentProject(b.port,windowId)
    const board=project.boards.find(x=>x.name===boardName)
    if(!board)throw new Error("The active EasyEDA Pro project does not contain board '"+boardName+"'. Open the matching NUCLEO project in EasyEDA Pro. Available boards: "+project.boards.map(x=>x.name).join(", "))
    active={port:b.port,windowId,project:project.project,projectDir:project.projectDir,projectPaths:project.projectPaths,boards:project.boards,pages:project.pages,boardName,lastVerification:null,engineVersion:project.engineVersion}
    return send(res,200,{projectName:project.project?.name??project.project?.projectName??"Active EasyEDA project",engineVersion:project.engineVersion,boards:project.boards,pages:project.pages,board,windowId,projectPaths:project.projectPaths})
   }
   if(u.pathname==="/api/update"&&req.method==="POST"){
    if(!active)return send(res,409,{error:"Attach the active EasyEDA project first"})
    const baseHashes=JSON.parse(String(req.headers["x-pwb-base-hashes"]??"null"))
    const result=await bridgeApplyNativePatch(active.port,active.windowId,active.projectDir,active.projectPaths,await body(req),baseHashes)
    active.lastVerification=null
    return send(res,200,result)
   }
   if(u.pathname==="/api/verify"&&req.method==="POST"){
    if(!active)return send(res,409,{error:"Connect to EasyEDA Pro and attach the active project first"})
    const {boardName}=await jsonBody(req)
    if(boardName!==active.boardName)throw new Error("Attach the selected board before verification")
    const result=await bridgeVerifyBoard(active.port,active.windowId,boardName)
    active.lastVerification={...result,boardName}
    return send(res,200,result)
   }
   if(u.pathname==="/api/export"&&req.method==="POST"){
    if(!active)return send(res,409,{error:"Attach the active EasyEDA project first"})
    const {boardName}=await jsonBody(req)
    if(boardName!==active.boardName)throw new Error("Attach the selected board before export")
    const result=await bridgeExportBoard(active.port,active.windowId,boardName)
    active.lastVerification=result.verification
    return send(res,200,{fileName:boardName.replace(/[^a-z0-9_-]+/gi,"_")+"_REVIEW_ONLY.zip",zipBase64:Buffer.from(result.zip).toString("base64"),manifest:result.manifest})
   }
   if(u.pathname==="/api/close"&&req.method==="POST"){active=null;return send(res,200,{detached:true})}
   if(req.method==="GET")return await staticFile(req,res)
   return send(res,404,{error:"Not found"})
  }catch(e){send(res,500,{error:e.message||String(e)})}
 })
 server.listen(port,host,()=>console.log("PCB Workbench local web UI: http://"+host+":"+port+"/handoff.html\nScanning EasyEDA Pro Bridge Server ports 49620–49629.\nBound to loopback only; no tunnel or remote access."))
 process.on("SIGINT",()=>server.close(()=>process.exit(0)))
}
start().catch(e=>{console.error(e);process.exit(1)})
