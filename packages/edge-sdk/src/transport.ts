import type {
  Capsule,
  CapsuleRequest,
} from "@setusync/protocol";

export interface CapsuleTransport {
  fetchCapsule(request: CapsuleRequest): Promise<Capsule>;
}