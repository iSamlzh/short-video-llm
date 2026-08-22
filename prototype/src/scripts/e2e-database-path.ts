import { randomUUID } from "node:crypto"

export function createE2EDatabasePath(pid = process.pid) {
  return `.data/e2e-${pid}-${randomUUID()}.sqlite`
}
