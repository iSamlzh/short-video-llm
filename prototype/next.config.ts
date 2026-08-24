import type { NextConfig } from "next"
import { PHASE_PRODUCTION_SERVER } from "next/constants"
import { validateRuntimeEnvironment } from "./src/lib/runtime-environment-validation"

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  allowedDevOrigins: ["localhost", "127.0.0.1"],
}

export default function config(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_SERVER) validateRuntimeEnvironment(process.env)
  return nextConfig
}
