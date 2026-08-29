import { getContentBrainServices } from "../services/content-brain-service-factory"
import { validateRuntimeEnvironment } from "../lib/runtime-environment-validation"
import { getAppDatabase } from "../lib/db/app-database"
import { StructureObservationProjector } from "../services/structure-observation-projector"

validateRuntimeEnvironment(process.env)

const controller = new AbortController()
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => controller.abort())
}

console.info(JSON.stringify({ event: "content_analysis_worker_started", pid: process.pid }))
const projector = new StructureObservationProjector(getAppDatabase())
const project = () => {
  try {
    const result = projector.processPending(50)
    if (result.claimed) console.info(JSON.stringify({ event: "structure_observation_outbox_processed", ...result }))
  } catch (error) {
    console.error(JSON.stringify({
      event: "structure_observation_outbox_failed",
      errorCode: (error as Error).message || "UNKNOWN_ERROR",
    }))
  }
}
project()
const projectionTimer = setInterval(project, 5_000)
try {
  await getContentBrainServices().analysisJobs.runForever(controller.signal)
} finally {
  clearInterval(projectionTimer)
}
console.info(JSON.stringify({ event: "content_analysis_worker_stopped", pid: process.pid }))
