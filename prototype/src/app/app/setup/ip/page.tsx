import { OnboardingRouteView } from "@/components/onboarding/OnboardingRouteView"
import { requireTenantAccess } from "@/lib/auth/request-access"

export default async function IpSetupPage() {
  await requireTenantAccess()
  return <main><OnboardingRouteView /></main>
}
