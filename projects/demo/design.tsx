// Integration coupon only. No electrical product claim or assembly approval.
export default function Design() {
  return (
    <board width="20mm" height="15mm">
      <resistor name="R1" resistance="10k" footprint="0805" pcbX={-4} pcbY={0} schX={-2} schY={1} />
      <resistor name="R2" resistance="10k" footprint="0805" pcbX={4} pcbY={0} schX={2} schY={1} />
      <trace from="R1.pin1" to="R2.pin1" />
      <trace from="R1.pin2" to="R2.pin2" />
    </board>
  )
}
