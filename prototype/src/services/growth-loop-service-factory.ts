import { getAppDatabase } from "../lib/db/app-database"
import { CurrentScopeRepository } from "../lib/db/current-scope-repository"
import { MetricsRepository } from "../lib/db/metrics-repository"
import { PublicationRepository } from "../lib/db/publication-repository"
import { OpenAiCompatibleAdapter } from "../lib/llm/adapter"
import { PrototypeFixtureLlmAdapter } from "../lib/llm/fake"
import { StructuredLlmClient } from "../lib/llm/structured"
import { parseMetricFile } from "../lib/import/spreadsheet-parser"
import { MetricImportService } from "./metric-import-service"
import { PublicationMatcher } from "./publication-matcher"
import { PublicationService } from "./publication-service"
import { ReviewService } from "./review-service"
import { TenantMemoryService } from "./tenant-memory-service"

export type GrowthLoopServices = ReturnType<typeof createGrowthLoopServices>

let singleton: GrowthLoopServices | undefined

export function getGrowthLoopServices() {
  if (!singleton) singleton = createGrowthLoopServices()
  return singleton
}

function createGrowthLoopServices() {
  const database = getAppDatabase()
  const publicationRepository = new PublicationRepository(database)
  const metricsRepository = new MetricsRepository(database)
  const publications = new PublicationService(database, publicationRepository)
  const matcher = new PublicationMatcher(database, metricsRepository, publicationRepository, publications)
  const imports = new MetricImportService(database, metricsRepository, parseMetricFile, matcher)
  const fixtureAllowed = process.env.PROTOTYPE_TEST_MODE === "true" && process.env.PLAYWRIGHT_TEST_MODE === "true"
  const llm = new StructuredLlmClient(fixtureAllowed ? new PrototypeFixtureLlmAdapter() : new OpenAiCompatibleAdapter())
  return {
    currentScope: new CurrentScopeRepository(database),
    publications,
    imports,
    matcher,
    reviews: new ReviewService(database, llm),
    memory: new TenantMemoryService(database),
  }
}
