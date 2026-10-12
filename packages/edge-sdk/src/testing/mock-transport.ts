import type { CapsuleRequest } from "@setusync/protocol";

import type { CapsuleTransport } from "../transport.js";
import { getMockCapsule } from "./mock-capsule.js";

export class MockCapsuleTransport implements CapsuleTransport {
  public async fetchCapsule(
    request: CapsuleRequest,
  ) {
    const capsule = getMockCapsule();

    if (
      request.engine !== capsule.body.engine ||
      request.query !== "government hospital"
    ) {
      throw new Error("Mock capsule not found for request");
    }

    return capsule;
  }
}