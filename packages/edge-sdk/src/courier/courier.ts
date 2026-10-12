import type { Capsule } from "@setusync/protocol";

export interface CourierEnvelope {
  version: 1;
  capsule: Capsule;
}

export interface Courier {
  send(capsule: Capsule): Promise<void>;
  receive(): Promise<Capsule | undefined>;
}

export function createCourierEnvelope(
  capsule: Capsule,
): CourierEnvelope {
  return {
    version: 1,
    capsule: structuredClone(capsule),
  };
}

export function parseCourierEnvelope(
  envelope: CourierEnvelope,
): Capsule {
  if (envelope.version !== 1) {
    throw new Error(
      "Unsupported courier envelope version",
    );
  }

  return structuredClone(envelope.capsule);
}

export class MemoryCourier implements Courier {
  private envelope: CourierEnvelope | undefined;

  public async send(capsule: Capsule): Promise<void> {
    this.envelope = createCourierEnvelope(capsule);
  }

  public async receive(): Promise<Capsule | undefined> {
    if (this.envelope === undefined) {
      return undefined;
    }

    const capsule = parseCourierEnvelope(
      this.envelope,
    );

    this.envelope = undefined;

    return capsule;
  }
}