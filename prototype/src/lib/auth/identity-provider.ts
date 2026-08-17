import type { ActorAudience } from "../../domain/access"

export interface IdentityProvider {
  authenticate(email: string, password: string): Promise<{ userId: string; audience: ActorAudience }>
}
