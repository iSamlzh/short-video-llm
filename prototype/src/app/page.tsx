import { redirect } from "next/navigation"
import { resolveCurrentAccess } from "@/lib/auth/request-access"

export default async function HomePage() {
  const context = await resolveCurrentAccess()
  if (!context) redirect("/login")
  redirect(context.audience === "platform" ? "/platform/content-brain" : "/app/today")
}
