export type RunState =
  | "EDITING_IP" | "READY_FOR_TOPICS" | "GENERATING_TOPICS" | "WAITING_TOPIC_SELECTION"
  | "READY_FOR_SCRIPTS" | "GENERATING_SCRIPTS" | "WAITING_SCRIPT_SELECTION"
  | "READY_FOR_QA" | "RUNNING_QA" | "WAITING_LOCK_CONFIRMATION" | "LOCKED"
  | "SIMULATING_PUBLICATION" | "WAITING_REVIEW" | "REVIEWING" | "REVIEWED"

export type RunCommand =
  | "GENERATE_TOPICS" | "TOPICS_GENERATED" | "SELECT_TOPIC"
  | "GENERATE_SCRIPTS" | "SCRIPTS_GENERATED" | "SELECT_SCRIPT"
  | "RUN_QA" | "QA_COMPLETED" | "LOCK" | "SIMULATE_PUBLICATION"
  | "PUBLICATION_SIMULATED" | "GENERATE_REVIEW" | "REVIEW_COMPLETED"

export interface IpProfile {
  displayName: string
  experience: string
  expertise: string
  audience: string
  voiceStyle: string
  boundaries: string
}

export interface PrototypeRun {
  id: string
  state: RunState
  inputVersion: number
  schemaVersion: number
  ipProfile: IpProfile
  createdAt: string
  updatedAt: string
}

export interface VersionedBatch<T> {
  version: number
  inputVersion: number
  items: T[]
  superseded: boolean
}
