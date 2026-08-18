import { OpenAiCompatibleAdapter } from "../lib/llm/adapter"
import { PrototypeFixtureLlmAdapter } from "../lib/llm/fake"
import { StructuredLlmClient } from "../lib/llm/structured"
import { IpPortraitService } from "./ip-portrait-service"

let singleton: IpPortraitService | undefined

export function getIpPortraitService() {
  if (!singleton) {
    const fixtureAllowed = process.env.PROTOTYPE_TEST_MODE === "true" && process.env.PLAYWRIGHT_TEST_MODE === "true"
    const adapter = fixtureAllowed ? new PrototypeFixtureLlmAdapter() : new OpenAiCompatibleAdapter()
    singleton = new IpPortraitService(new StructuredLlmClient(adapter))
  }
  return singleton
}
