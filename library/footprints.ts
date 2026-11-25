import { fetchEasyEDAComponent, EasyEdaJsonSchema, convertEasyEdaJsonToCircuitJson } from "easyeda"
import { part } from "./parts"

type Footprint = {footprintCircuitJson: ReturnType<typeof convertEasyEdaJsonToCircuitJson>}
const cache=new Map<string,Promise<Footprint>>()

async function fetchExact(lcsc:string):Promise<Footprint>{
  part(lcsc)
  // This is the EasyEDA converter's public retrieval path. No authentication or
  // cookies are supplied by the workbench. Never replace failed imports with a generic shape.
  const raw=await fetchEasyEDAComponent(lcsc,{includeModelMetadata:false})
  const source=raw as any
  const candidates=[source.lcsc?.number,source.szlcsc?.number,source.dataStr?.head?.c_para?.["Supplier Part"]]
  if(!candidates.some(x=>String(x??"").trim().toUpperCase()===lcsc))
    throw new Error("EasyEDA returned a different or unverifiable part for "+lcsc)
  const data=convertEasyEdaJsonToCircuitJson(EasyEdaJsonSchema.parse(raw),{useModelCdn:true})
  const pads=data.filter(e=>e.type==="pcb_smtpad"||e.type==="pcb_plated_hole")
  if(pads.length<2)throw new Error("No usable footprint pads for "+lcsc)
  return {footprintCircuitJson:data}
}

export function jlcpcbFootprintResolver(name:string):Promise<Footprint>{
  const id=name.trim().toUpperCase()
  if(!/^C\d+$/.test(id))throw new Error("Bad JLCPCB footprint reference: "+name)
  if(!cache.has(id))cache.set(id,fetchExact(id))
  return cache.get(id)!
}
