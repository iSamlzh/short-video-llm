import { getAppDatabase } from "../lib/db/app-database"
import { clearDemoData } from "./demo-data"

clearDemoData(getAppDatabase(), process.env.PROTOTYPE_ALLOW_DEMO_CLEAR === "true")
console.log("演示数据已清理，正式数据已保留。")
