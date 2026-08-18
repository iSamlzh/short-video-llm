import { getAppDatabase } from "../lib/db/app-database"
import { IpOnboardingRepository } from "../lib/db/ip-onboarding-repository"
import { IpOnboardingSessionService } from "./ip-onboarding-session-service"
import { getIpPortraitService } from "./ip-portrait-service-factory"
import { IpProfileService } from "./ip-profile-service"

let singleton: { sessions: IpOnboardingSessionService; profiles: IpProfileService } | undefined

export function getIpOnboardingServices() {
  if (singleton) return singleton
  const database = getAppDatabase()
  singleton = {
    sessions: new IpOnboardingSessionService(
      new IpOnboardingRepository(database),
      getIpPortraitService(),
    ),
    profiles: new IpProfileService(database),
  }
  return singleton
}

export type IpOnboardingServices = ReturnType<typeof getIpOnboardingServices>
