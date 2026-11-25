import catalog from "./catalog.json"

type CatalogPart = typeof catalog.parts[number]
const index = new Map<string,CatalogPart>()
for (const p of catalog.parts) {
  if (!/^C\d+$/.test(p.lcsc) || index.has(p.lcsc)) throw new Error("Invalid or duplicate JLCPCB number: " + p.lcsc)
  if (p.officialUrl !== "https://jlcpcb.com/partdetail/" + p.lcsc || p.footprint !== "jlcpcb:" + p.lcsc)
    throw new Error("Catalog source / footprint mismatch: " + p.lcsc)
  index.set(p.lcsc,p)
}
export function part(lcsc:string) {
  const p = index.get(lcsc)
  if (!p) throw new Error("Part must be registered from JLCPCB first: " + lcsc)
  return p
}
export function resolveParts(rows: {ref:string,lcsc:string,rotationOffset:number|null,reviewed:boolean}[]) {
  const refs = new Set()
  return rows.map(row => {
    if (!/^[A-Za-z]+\d+$/.test(row.ref) || refs.has(row.ref)) throw new Error("Invalid or duplicate reference: " + row.ref)
    refs.add(row.ref)
    const p=part(row.lcsc)
    return {...p,ref:row.ref,rotationOffset:row.rotationOffset,reviewed:row.reviewed===true && p.geometryReviewed && p.datasheetReviewed && p.availabilityChecked!==null && typeof p.stock==="number" && p.stock>0}
  })
}
type Placement = {name:string,lcsc:string,pcbX?:number,pcbY?:number,pcbRotation?:number,schX?:number,schY?:number,schRotation?:number}
export function JlcPassive({lcsc,...props}:Placement) {
  const p=part(lcsc)
  const supplierPartNumbers={jlcpcb:[p.lcsc]}
  // Use JLCPCB's exact part footprint, rather than assuming that all packages share a land pattern.
  if(p.kind==="resistor")return <resistor {...props} resistance={p.value} footprint={p.footprint} supplierPartNumbers={supplierPartNumbers} />
  if(p.kind==="capacitor")return <capacitor {...props} capacitance={p.value} footprint={p.footprint} supplierPartNumbers={supplierPartNumbers} />
  throw new Error("Unsupported passive kind: "+p.kind)
}
export function assertSourceParity(json:any[], rows:ReturnType<typeof resolveParts>) {
  const components=json.filter(e=>e.type==="source_component")
  const byRef=new Map(components.map(e=>[e.name,e]))
  if(components.length!==rows.length || byRef.size!==rows.length)throw new Error("Schematic/catalog reference count mismatch")
  for(const row of rows){
    const c=byRef.get(row.ref)
    if(!c)throw new Error("Missing source component: "+row.ref)
    const numbers=c.supplier_part_numbers?.jlcpcb
    if(!Array.isArray(numbers)||numbers.length!==1||numbers[0]!==row.lcsc)
      throw new Error("Schematic/JLCPCB part identity mismatch: "+row.ref+" ("+JSON.stringify(c.supplier_part_numbers)+")")
    const pcbs=json.filter(e=>e.type==="pcb_component"&&e.source_component_id===c.source_component_id)
    if(pcbs.length!==1)throw new Error("Missing or duplicate PCB footprint: "+row.ref)
    const pads=json.filter(e=>e.pcb_component_id===pcbs[0].pcb_component_id&&(e.type==="pcb_smtpad"||e.type==="pcb_plated_hole"))
    if(pads.length<2)throw new Error("PCB footprint did not resolve to physical pads: "+row.ref)
  }
}
