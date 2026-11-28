import { JlcPassive } from "../library/parts"
import { projectToCircuitPlan } from "./project-adapter.js"
type Plan = ReturnType<typeof projectToCircuitPlan>
export function NativeDesign({plan,routingDisabled}:{plan:Plan,routingDisabled:boolean}) {
  return <board width={plan.board.width+"mm"} height={plan.board.height+"mm"} routingDisabled={routingDisabled}>
    {plan.placements.map(p=><JlcPassive key={p.name} {...p}/>)}
    {plan.nets.map(name=><net key={name} name={name}/>)}
    {plan.traces.map(t=><trace key={t.from} from={t.from} to={t.to}/>)}
  </board>
}
