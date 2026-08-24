import { getAppDatabase } from "../lib/db/app-database"
import { seedDemoData } from "./demo-data"
import { resolveAppEnvironment } from "../lib/runtime-features"

if (resolveAppEnvironment(process.env) === "production") throw new Error("DEMO_SEED_FORBIDDEN_IN_PRODUCTION")
const password = process.env.PROTOTYPE_DEMO_PASSWORD
await seedDemoData(getAppDatabase(), password ?? "demo-password")
console.log("Demo team seeded. Accounts: owner/operator/reviewer/platform @ example.test")
