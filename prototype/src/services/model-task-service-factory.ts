import { getAppDatabase } from "../lib/db/app-database"
import { ModelTaskService } from "./model-task-service"

let singleton: ModelTaskService | undefined

export function getModelTaskService() {
  singleton ??= new ModelTaskService(getAppDatabase())
  return singleton
}
