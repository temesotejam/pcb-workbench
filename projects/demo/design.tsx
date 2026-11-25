// Integration coupon. Exact JLCPCB identities; native KiCad parity test.
import { JlcPassive } from "../../library/parts"
import meta from "./project.json"
export default function Design() {
  const [r1,r2]=meta.parts
  return (
    <board width="20mm" height="15mm">
      <JlcPassive name={r1.ref} lcsc={r1.lcsc} pcbX={-4} pcbY={0} schX={-2} schY={1} />
      <JlcPassive name={r2.ref} lcsc={r2.lcsc} pcbX={4} pcbY={0} schX={2} schY={1} />
      <net name="R1_R2_PIN1" />
      <net name="R1_R2_PIN2" />
      <trace from=".R1 > .pin1" to="net.R1_R2_PIN1" />
      <trace from=".R2 > .pin1" to="net.R1_R2_PIN1" />
      <trace from=".R1 > .pin2" to="net.R1_R2_PIN2" />
      <trace from=".R2 > .pin2" to="net.R1_R2_PIN2" />
    </board>
  )
}
