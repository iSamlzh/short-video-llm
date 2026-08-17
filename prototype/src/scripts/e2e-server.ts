import { spawn } from "node:child_process"
import { resolve } from "node:path"

process.env.PROTOTYPE_TEST_MODE = "true"
process.env.PLAYWRIGHT_TEST_MODE = "true"
process.env.PROTOTYPE_DB_PATH = `.data/e2e-${process.pid}.sqlite`
process.env.PROTOTYPE_DEMO_CONTROLS = "true"

const [{ getAppDatabase }, { seedDemoData, seedE2ERealPublications }] = await Promise.all([
  import("../lib/db/app-database"),
  import("./demo-data"),
])
const database = getAppDatabase()
await seedDemoData(database, "demo-password")
seedE2ERealPublications(
  database,
  process.env.PROTOTYPE_TEST_MODE === "true" && process.env.PLAYWRIGHT_TEST_MODE === "true",
)

const nextBin = resolve(process.cwd(), "node_modules/next/dist/bin/next")
const child = spawn(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "--port", "3100"], {
  stdio: "inherit",
  env: process.env,
})
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal))
child.on("exit", (code) => process.exit(code ?? 0))
