import { resolveCurrentAccess } from "@/lib/auth/request-access"

export async function GET() {
  const context = await resolveCurrentAccess()
  return context ? Response.json(context) : Response.json({ errorCode: "UNAUTHENTICATED" }, { status: 401 })
}
