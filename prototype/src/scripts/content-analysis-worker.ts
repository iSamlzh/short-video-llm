import { getContentBrainServices } from "../services/content-brain-service-factory"
import { validateRuntimeEnvironment } from "../lib/runtime-environment-validation"

validateRuntimeEnvironment(process.env)

const controller = new AbortController()
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => controller.abort())
}

console.info(JSON.stringify({ event: "content_analysis_worker_started", pid: process.pid }))
await getContentBrainServices().analysisJobs.runForever(controller.signal)
console.info(JSON.stringify({ event: "content_analysis_worker_stopped", pid: process.pid }))
