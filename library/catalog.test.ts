import { test, expect } from "bun:test"
import { part,resolveParts,assertSourceParity } from "./parts"

const p=()=>resolveParts([{ref:"R1",lcsc:"C17414",rotationOffset:null,reviewed:false}])
const source={type:"source_component",source_component_id:"src1",name:"R1",supplier_part_numbers:{jlcpcb:["C17414"]}}
const pcb={type:"pcb_component",source_component_id:"src1",pcb_component_id:"pcb1"}
const pads=[{type:"pcb_smtpad",pcb_component_id:"pcb1"},{type:"pcb_smtpad",pcb_component_id:"pcb1"}]
test("exact catalog identity is resolved and remains unreviewed",()=>{
  const r=p()[0];expect(r.manufacturerPart).toBe("0805W8F1002T5E");expect(r.footprint).toBe("jlcpcb:C17414");expect(r.reviewed).toBe(false)
})
test("unregistered part rejected",()=>expect(()=>part("C9999999999999")).toThrow())
test("duplicate reference rejected",()=>expect(()=>resolveParts([{ref:"R1",lcsc:"C17414",rotationOffset:null,reviewed:false},{ref:"R1",lcsc:"C17414",rotationOffset:null,reviewed:false}])).toThrow())
test("source reference and part number parity",()=>expect(()=>assertSourceParity([source,pcb,...pads],p())).not.toThrow())
test("wrong supplier number rejected",()=>expect(()=>assertSourceParity([{...source,supplier_part_numbers:{jlcpcb:["C25804"]}},pcb,...pads],p())).toThrow())
test("missing physical pads rejected",()=>expect(()=>assertSourceParity([source,pcb],p())).toThrow())
