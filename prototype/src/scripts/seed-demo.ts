import { getAppDatabase } from "../lib/db/app-database"
import { seedDemoData } from "./demo-data"

const password = process.env.PROTOTYPE_DEMO_PASSWORD
if (!password && process.env.NODE_ENV === "production") throw new Error("PROTOTYPE_DEMO_PASSWORD_REQUIRED")
await seedDemoData(getAppDatabase(), password ?? "demo-password")
console.log("Demo team seeded. Accounts: owner/operator/reviewer/platform @ example.test")
