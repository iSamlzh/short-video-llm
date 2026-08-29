import { getAppDatabase } from "../lib/db/app-database"
import { ContentBrainRepository } from "../lib/db/content-brain-repository"
import { OpenAiCompatibleAdapter } from "../lib/llm/adapter"
import { PrototypeFixtureLlmAdapter } from "../lib/llm/fake"
import { StructuredLlmClient } from "../lib/llm/structured"
import { ContentAnalysisService } from "./content-analysis-service"
import { ContentAnalysisJobService } from "./content-analysis-job-service"
import { ContentBrainWorkflowService } from "./content-brain-workflow-service"
import { ContentSampleService } from "./content-sample-service"
import { ModelTaskService } from "./model-task-service"

export type ContentBrainServices = ReturnType<typeof createContentBrainServices>

let singleton: ContentBrainServices | undefined

export function getContentBrainServices() {
  if (!singleton) singleton = createContentBrainServices()
  return singleton
}

function createContentBrainServices() {
  const database = getAppDatabase()
  const repository = new ContentBrainRepository(database)
  const fixtureAllowed = process.env.PROTOTYPE_TEST_MODE === "true" && process.env.PLAYWRIGHT_TEST_MODE === "true"
  const llm = new StructuredLlmClient(fixtureAllowed ? new PrototypeFixtureLlmAdapter() : new OpenAiCompatibleAdapter())
  const analysis = new ContentAnalysisService(database, llm, repository)
  return {
    repository,
    samples: new ContentSampleService(repository),
    analysis,
    analysisJobs: new ContentAnalysisJobService(database, analysis, new ModelTaskService(database)),
    workflow: new ContentBrainWorkflowService(database, llm, repository),
  }
}
