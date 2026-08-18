import { getAppDatabase } from "../lib/db/app-database"
import { IpOnboardingRepository } from "../lib/db/ip-onboarding-repository"
import { IpOnboardingSessionService } from "./ip-onboarding-session-service"

let singleton: { sessions: IpOnboardingSessionService } | undefined

export function getIpOnboardingServices() {
  if (singleton) return singleton
  singleton = {
    sessions: new IpOnboardingSessionService(new IpOnboardingRepository(getAppDatabase())),
  }
  return singleton
}

export type IpOnboardingServices = ReturnType<typeof getIpOnboardingServices>
