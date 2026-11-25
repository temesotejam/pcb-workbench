import { Circuit } from "tscircuit"
import { CircuitJsonToKicadSchConverter, CircuitJsonToKicadPcbConverter, CircuitJsonToKicadProConverter } from "circuit-json-to-kicad"
import { convertCircuitJsonToSchematicSvg, convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { cp, mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises"
import { resolve } from "node:path"
import { resolveParts, assertSourceParity } from "../library/parts"
import { jlcpcbFootprintResolver } from "../library/footprints"

type SExprBlock = { start:number; end:number; text:string }
function sexprBlocks(source:string, token:string):SExprBlock[] {
  const blocks:SExprBlock[]=[]
  let cursor=0
  while(true){
    const start=source.indexOf(token,cursor)
    if(start<0)break
    let depth=0,inString=false,escaped=false,end=-1
    for(let i=start;i<source.length;i++){
      const c=source[i]
      if(inString){
        if(escaped)escaped=false
        else if(c==="\\")escaped=true
        else if(c==='"')inString=false
        continue
      }
      if(c==='"'){inString=true;continue}
      if(c==="(")depth++
      else if(c===")"){depth--;if(depth===0){end=i+1;break}}
    }
    if(end<0)throw new Error("Unbalanced KiCad S-expression starting at "+start)
    blocks.push({start,end,text:source.slice(start,end)})
    cursor=end
  }
  return blocks
}
function replaceSexprBlocks(source:string,token:string,transform:(block:string)=>string):string{
  for(const b of sexprBlocks(source,token).reverse())source=source.slice(0,b.start)+transform(b.text)+source.slice(b.end)
  return source
}
function quoteKicad(s:string){return s.replace(/\\/g,"\\\\").replace(/"/g,'\\"')}
function snapLabelsAndWiresToSymbolPins(source:string){
  const pinBySymbolUnit=new Map<string,{x:number,y:number}[]>()
  for(const libBlock of sexprBlocks(source,"(lib_symbols")){
    for(const root of sexprBlocks(libBlock.text,"(symbol")){
      const libId=root.text.match(/^\(symbol\s+"([^"]+)"/)?.[1]
      if(!libId)continue
      const nestedStart=root.text.indexOf("\n")+1
      for(const child of sexprBlocks(root.text.slice(nestedStart),"(symbol")){
        const childName=child.text.match(/^\(symbol\s+"([^"]+)"/)?.[1]
        const suffix=childName?.match(/_(\d+)_(\d+)$/)
        if(!suffix)continue
        const unit=Number(suffix[1])
        for(const pin of sexprBlocks(child.text,"(pin ")){
          const at=pin.text.match(/\(at\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\)/)
          if(!at)continue
          const key=libId+"|"+unit
          if(!pinBySymbolUnit.has(key))pinBySymbolUnit.set(key,[])
          pinBySymbolUnit.get(key)!.push({x:Number(at[1]),y:Number(at[2])})
        }
      }
    }
  }
  const labels=sexprBlocks(source,"(label").flatMap(block=>{
    const at=block.text.match(/^\(label\s+"([^"]+)"[\s\S]*?\(at\s+(-?[\d.]+)\s+(-?[\d.]+)/)
    return at?[{name:at[1],x:Number(at[2]),y:Number(at[3])}]:[]
  })
  const wires=sexprBlocks(source,"(wire").flatMap(block=>{
    const pts=[...block.text.matchAll(/\(xy\s+(-?[\d.]+)\s+(-?[\d.]+)\)/g)]
    return pts.length===2?[{a:{x:Number(pts[0][1]),y:Number(pts[0][2])},b:{x:Number(pts[1][1]),y:Number(pts[1][2])}}]:[]
  })
  const replacements=new Map<string,{pin:{x:number,y:number},label:{x:number,y:number}}>()
  for(const instance of sexprBlocks(source,"(symbol")){
    const libId=instance.text.match(/\(lib_id\s+"([^"]+)"/)?.[1]
    if(!libId)continue
    const at=instance.text.match(/\(at\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/)
    const unit=Number(instance.text.match(/\(unit\s+(\d+)\)/)?.[1]??0)
    if(!at)continue
    const originX=Number(at[1]),originY=Number(at[2]),angle=Number(at[3])*Math.PI/180
    for(const pin of pinBySymbolUnit.get(libId+"|"+unit)??[]){
      const x=originX+pin.x*Math.cos(angle)-pin.y*Math.sin(angle)
      const y=originY-(pin.x*Math.sin(angle)+pin.y*Math.cos(angle))
      const candidates=labels.filter(label=>{
        const dx=Math.abs(label.x-x),dy=Math.abs(label.y-y)
        return (dx<=2.55&&dy<=0.01)||(dy<=2.55&&dx<=0.01)
      })
      if(candidates.length!==1)continue
      const old=candidates[0],key=old.x.toFixed(5)+","+old.y.toFixed(5)
      const prior=replacements.get(key)
      if(prior&&(Math.abs(prior.pin.x-x)>0.01||Math.abs(prior.pin.y-y)>0.01))continue
      const connected=wires.filter(w=>(
        Math.abs(w.a.x-old.x)<=0.01&&Math.abs(w.a.y-old.y)<=0.01
      )||(
        Math.abs(w.b.x-old.x)<=0.01&&Math.abs(w.b.y-old.y)<=0.01
      ))
      let labelTarget={x,y}
      if(connected.length===1){
        const w=connected[0]
        labelTarget=Math.abs(w.a.x-old.x)<=0.01&&Math.abs(w.a.y-old.y)<=0.01?w.b:w.a
      }
      replacements.set(key,{pin:{x,y},label:labelTarget})
    }
  }
  if(!replacements.size)return {content:source,snapped:0}
  const format=(v:number)=>Number(v.toFixed(6)).toString()
  let content=replaceSexprBlocks(source,"(label",block=>block.replace(/\(at\s+(-?[\d.]+)\s+(-?[\d.]+)/,(all,x,y)=>{
    const target=replacements.get(Number(x).toFixed(5)+","+Number(y).toFixed(5))?.label
    return target?"(at "+format(target.x)+" "+format(target.y):all
  }))
  content=replaceSexprBlocks(content,"(wire",block=>block.replace(/\(xy\s+(-?[\d.]+)\s+(-?[\d.]+)\)/g,(all,x,y)=>{
    const target=replacements.get(Number(x).toFixed(5)+","+Number(y).toFixed(5))?.pin
    return target?"(xy "+format(target.x)+" "+format(target.y)+")":all
  }))
  return {content,snapped:replacements.size}
}

function snapWireEndsToLabels(source:string,names:Set<string>){
  const labels=sexprBlocks(source,"(label").flatMap(b=>{
    const name=b.text.match(/^\(label\s+"([^"]+)"/)?.[1],at=b.text.match(/\(at\s+(-?[\d.]+)\s+(-?[\d.]+)/)
    return name&&names.has(name)&&at?[{name,x:Number(at[1]),y:Number(at[2])}]:[]
  })
  let snapped=0
  const content=replaceSexprBlocks(source,"(wire",block=>{
    const points=[...block.matchAll(/\(xy\s+(-?[\d.]+)\s+(-?[\d.]+)\)/g)]
    let updated=block
    for(const p of points){
      const x=Number(p[1]),y=Number(p[2])
      const candidates=labels.filter(l=>{
        const dx=Math.abs(l.x-x),dy=Math.abs(l.y-y)
        return (dx<=0.01&&Math.abs(dy-2.54)<=0.01)||(dy<=0.01&&Math.abs(dx-2.54)<=0.01)
      })
      if(candidates.length===1){updated=updated.replace(p[0],"(xy "+candidates[0].x+" "+candidates[0].y+")");snapped++}
    }
    return updated
  })
  return {content,snapped}
}
function prepareKicadParity(schematicFiles:{filename:string,content:string}[],pcbText:string,netNames:string[]){
  const footprintByRef=new Map<string,string>(),descriptionByRef=new Map<string,string>(),footprintLibraryFiles=new Map<string,string>(),symbolIdMap=new Map<string,string>(),symbolLibraryFiles=new Map<string,string>()
  for(const block of sexprBlocks(pcbText,"(footprint")){
    const fullName=block.text.match(/^\(footprint\s+"([^"]+)"/)?.[1],ref=block.text.match(/\(property "Reference" "([^"]+)"/)?.[1]
    if(!fullName||!ref)continue
    footprintByRef.set(ref,fullName)
    const split=fullName.indexOf(":")
    if(split<1)throw new Error("KiCad footprint ID must include a library: "+fullName)
    const lib=fullName.slice(0,split),item=fullName.slice(split+1)
    let snapshot=block.text.replace(/^\(footprint\s+"[^"]+"/,'(footprint "'+quoteKicad(item)+'" (version 20250114) (generator "pcbnew")')
    snapshot=snapshot.replace(/(\n\s*)\(at [^\n]*\)/,"$1(at 0 0 0)")
    snapshot=snapshot.replace(/\(uuid\s+[^)]+\)/g,"")
    snapshot=snapshot.replace(/\(net\s+\d+\s+"[^"]+"\)/g,"")
    snapshot=snapshot.replace(/\(property "Reference" "[^"]*"/,'(property "Reference" "REF**"')
    snapshot=snapshot.replace(/\(property "Value" "[^"]*"/,'(property "Value" "'+quoteKicad(item)+'"')
    snapshot=snapshot.replace(/\(property "Supplier Part Number" "[^"]*"/g,'(property "Supplier Part Number" ""')
    snapshot=replaceSexprBlocks(snapshot,"(model",()=> "")
    const key=lib+"/"+item,prior=footprintLibraryFiles.get(key)
    if(prior&&prior!==snapshot)throw new Error("Same KiCad footprint ID has different geometry: "+key)
    footprintLibraryFiles.set(key,snapshot)
  }
  for(const file of schematicFiles){
    for(const libBlock of sexprBlocks(file.content,"(lib_symbols")){
      for(const symbolBlock of sexprBlocks(libBlock.text,"(symbol")){
        const fullName=symbolBlock.text.match(/^\(symbol\s+"([^"]+)"/)?.[1]
        if(!fullName)continue
        const split=fullName.indexOf(":")
        if(split<1)continue
        const originalLib=fullName.slice(0,split),item=fullName.slice(split+1)
        const libraryItem=originalLib+"__"+item,newId="tscircuit:"+libraryItem
        symbolIdMap.set(fullName,newId)
        const snapshot=symbolBlock.text.replace(/^\(symbol\s+"[^"]+"/,'(symbol "'+quoteKicad(libraryItem)+'"').replaceAll('(symbol "'+quoteKicad(item)+'_','(symbol "'+quoteKicad(libraryItem)+'_')
        const prior=symbolLibraryFiles.get(libraryItem)
        if(prior&&prior!==snapshot)throw new Error("Duplicate custom symbol has different definition: "+libraryItem)
        symbolLibraryFiles.set(libraryItem,snapshot)
      }
    }
    for(const block of sexprBlocks(file.content,"(symbol")){
      const ref=block.text.match(/\(property "Reference" "([^"]+)"/)?.[1]
      if(!ref||!footprintByRef.has(ref))continue
      const desc=block.text.match(/\(property "Description" "([^"]*)"/)?.[1]
      if(desc)descriptionByRef.set(ref,desc)
    }
  }
  const schematicFixes:{filename:string,pinLabelMoves:number,netWireSnaps:number}[]=[]
  let patchedSchematics=schematicFiles.map(file=>{
    let content=file.content
    for(const [oldId,newId] of symbolIdMap){content=content.replaceAll('"'+oldId+'"','"'+newId+'"');const oldItem=oldId.slice(oldId.indexOf(':')+1),newItem=newId.slice(newId.indexOf(':')+1);content=content.replaceAll('(symbol "'+oldItem+'_','(symbol "'+newItem+'_')}
    content=replaceSexprBlocks(content,"(symbol",block=>{
      const ref=block.match(/\(property "Reference" "([^"]+)"/)?.[1],footprint=ref?footprintByRef.get(ref):undefined
      if(!footprint)return block
      return block.replace(/\(property "Footprint" ""/,'(property "Footprint" "'+quoteKicad(footprint)+'"')
    })
    const pinSnap=snapLabelsAndWiresToSymbolPins(content)
    content=pinSnap.content
    const netSnap=snapWireEndsToLabels(content,new Set(netNames))
    content=netSnap.content
    schematicFixes.push({filename:file.filename,pinLabelMoves:pinSnap.snapped,netWireSnaps:netSnap.snapped})
    return {...file,content}
  })
  const patchedPcb=replaceSexprBlocks(pcbText,"(footprint",block=>{
    const ref=block.match(/\(property "Reference" "([^"]+)"/)?.[1],description=ref?descriptionByRef.get(ref):undefined
    if(!description)return block
    return block.replace(/\(property "Description" ""/,'(property "Description" "'+quoteKicad(description)+'"')
  }).replace(/(\(net\s+\d+\s+)"([^"]+)"/g,(all,prefix,name)=>netNames.includes(name)?prefix+'"/'+name+'"':all)
  for(const [ref,fullName] of footprintByRef){
    const description=descriptionByRef.get(ref)
    if(!description)continue
    const split=fullName.indexOf(":"),key=fullName.slice(0,split)+"/"+fullName.slice(split+1),snapshot=footprintLibraryFiles.get(key)
    if(snapshot)footprintLibraryFiles.set(key,snapshot.replace(/\(property "Description" ""/,'(property "Description" "'+quoteKicad(description)+'"'))
  }
  const symHeader='(kicad_symbol_lib\n  (version 20231120)\n  (generator "kicad_symbol_editor")\n'
  const symFile=symHeader+[...symbolLibraryFiles.values()].join("\n")+"\n)\n"
  const projectPrefix="$"+"{KIPRJMOD}/"
  const symTable='(sym_lib_table\n  (lib (name "tscircuit") (type "KiCad") (uri "'+projectPrefix+'tscircuit.kicad_sym") (options "") (descr "Generated source symbols"))\n)\n'
  const fpTable='(fp_lib_table\n  (lib (name "tscircuit") (type "KiCad") (uri "'+projectPrefix+'tscircuit.pretty") (options "") (descr "Exact imported component geometry"))\n)\n'
  return {schematicFiles:patchedSchematics,schematicFixes,pcbText:patchedPcb,footprintLibraryFiles,symFile,symTable,fpTable}
}

const root=resolve(import.meta.dir,"..")
const out=resolve(root,"dist")
await rm(out,{recursive:true,force:true})
await mkdir(out,{recursive:true})
await cp(resolve(root,"site"),out,{recursive:true})
const handoff=await Bun.build({entrypoints:[resolve(root,"site/handoff-entry.js")],target:"browser",outdir:out,naming:"handoff.js",minify:true})
if(!handoff.success)throw new Error(handoff.logs.map(String).join("\n"))
await rm(resolve(out,"handoff-entry.js"))
await cp(resolve(root,"library","catalog.json"),resolve(out,"catalog.json"))
const index=[]
let failed=false
for(const id of (await readdir(resolve(root,"projects"))).sort()){
  if(!/^[a-z0-9][a-z0-9-]*$/.test(id))throw new Error("Invalid project slug: "+id)
  const dir=resolve(root,"projects",id)
  const meta=JSON.parse(await readFile(resolve(dir,"project.json"),"utf8"))
  if(meta.id!==id)throw new Error("Project id mismatch: "+id)
  const path=resolve(out,"projects",id)
  await mkdir(path,{recursive:true})
  const result={id,name:meta.name,revision:meta.revision,purpose:meta.purpose,status:"blocked",parts:[] as ReturnType<typeof resolveParts>,errors:[] as string[],files:[] as string[]}
  try{
    result.parts=resolveParts(meta.parts)
    const Design=(await import(resolve(dir,"design.tsx"))).default
    const circuit=new Circuit({platform:{footprintLibraryMap:{jlcpcb:jlcpcbFootprintResolver}}})
    circuit.add(<Design />)
    await circuit.renderUntilSettled()
    const json=circuit.getCircuitJson()
    const namedNets=json.filter((x:any)=>x.type==="source_net").map((x:any)=>x.name)
    for(const expected of ["R1_R2_PIN1","R1_R2_PIN2"])if(!namedNets.includes(expected))throw new Error("Named net missing from Circuit JSON: "+expected)
    await writeFile(resolve(path,"circuit.json"),JSON.stringify(json,null,2));result.files.push("circuit.json")
    assertSourceParity(json,result.parts)
    await writeFile(resolve(path,"schematic.svg"),convertCircuitJsonToSchematicSvg(json))
    await writeFile(resolve(path,"pcb.svg"),convertCircuitJsonToPcbSvg(json));result.files.push("schematic.svg","pcb.svg")
    const sch=new CircuitJsonToKicadSchConverter(json);sch.runUntilFinished()
    const schFiles=sch.getOutputFiles({schematicFilename:"board.kicad_sch"}).filter((f:any)=>/^[a-zA-Z0-9_. -]+\.kicad_sch$/.test(f.filename)).map((f:any)=>({filename:f.filename,content:f.content}))
    const pcb=new CircuitJsonToKicadPcbConverter(json);pcb.runUntilFinished()
    const prepared=prepareKicadParity(schFiles,pcb.getOutputString(),namedNets)
    await writeFile(resolve(path,"schematic-fix-report.json"),JSON.stringify(prepared.schematicFixes,null,2));result.files.push("schematic-fix-report.json")
    for(const f of prepared.schematicFiles){await writeFile(resolve(path,f.filename),f.content);result.files.push(f.filename)}
    await writeFile(resolve(path,"board.kicad_pcb"),prepared.pcbText)
    const pro=new CircuitJsonToKicadProConverter(json,{projectName:"board",schematicFilename:"board.kicad_sch",pcbFilename:"board.kicad_pcb"});pro.runUntilFinished()
    await writeFile(resolve(path,"board.kicad_pro"),pro.getOutputString())
    const prettyByLib=new Map<string,string[]>()
    for(const [key,content] of prepared.footprintLibraryFiles){
      const [lib,item]=key.split("/"),libDir=resolve(path,lib+".pretty")
      await mkdir(libDir,{recursive:true});await writeFile(resolve(libDir,item+".kicad_mod"),content)
      prettyByLib.set(lib,[...(prettyByLib.get(lib)??[]),item+".kicad_mod"])
    }
    await writeFile(resolve(path,"tscircuit.kicad_sym"),prepared.symFile)
    await writeFile(resolve(path,"sym-lib-table"),prepared.symTable)
    await writeFile(resolve(path,"fp-lib-table"),prepared.fpTable)
    result.files.push("board.kicad_pcb","board.kicad_pro","tscircuit.kicad_sym","sym-lib-table","fp-lib-table",...([...prettyByLib].flatMap(([lib,files])=>files.map(f=>lib+".pretty/"+f))))
    const errors=json.filter((e:any)=>typeof e.type==="string"&&e.type.endsWith("_error"))
    result.errors=errors.map((e:any)=>JSON.stringify(e));result.status="preview"
  }catch(e){failed=true;result.errors.push(String(e));console.error(id,e)}
  await writeFile(resolve(path,"project.json"),JSON.stringify(result,null,2))
  index.push({id,name:meta.name,revision:meta.revision})
}
await writeFile(resolve(out,"projects.json"),JSON.stringify(index,null,2))
if(failed)process.exitCode=1
