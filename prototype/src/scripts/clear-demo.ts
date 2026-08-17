import { getAppDatabase } from "../lib/db/app-database"
import { clearDemoData } from "./demo-data"

clearDemoData(getAppDatabase(), process.env.PROTOTYPE_ALLOW_DEMO_CLEAR === "true")
console.log("Demo data cleared; formal data was preserved.")
