import { describe, expect, it } from "vitest";
import type { Capsule } from "@setusync/protocol";
import {
  createCourierEnvelope,
  MemoryCourier,
  parseCourierEnvelope,
} from "../src/courier/courier.js";

function createCapsule(): Capsule {
  return {
    v: 1,
    kid: "test-key",
    alg: "Ed25519",
    sig: "test-signature",
    body: {
      id: "capsule-id",
      key: "capsule-key",
      chash: "content-hash",
      engine: "google",
      params: {
        gl: "in",
        hl: "en",
      },
      fetched_at: "2026-10-04T12:00:00Z",
      ttl_s: 3600,
      source: {
        provider: "serpapi",
      },
      organic_results: [
        {
          position: 1,
          title: "Government Hospital Bhopal",
          link: "https://example.com/bhopal",
          snippet: "Public hospital services",
        },
      ],
      related_questions: [],
    },
  };
}

describe("Courier", () => {
  it("creates a versioned courier envelope", () => {
    const capsule = createCapsule();

    const envelope =
      createCourierEnvelope(capsule);

    expect(envelope.version).toBe(1);
    expect(envelope.capsule).toEqual(capsule);
    expect(envelope.capsule).not.toBe(capsule);
  });

  it("parses a valid courier envelope", () => {
    const capsule = createCapsule();

    const envelope =
      createCourierEnvelope(capsule);

    const parsed =
      parseCourierEnvelope(envelope);

    expect(parsed).toEqual(capsule);
    expect(parsed).not.toBe(capsule);
  });

  it("rejects an unsupported envelope version", () => {
    const capsule = createCapsule();

    const envelope = {
      version: 2,
      capsule,
    };

    expect(() =>
      parseCourierEnvelope(envelope),
    ).toThrow(
      "Unsupported courier envelope version",
    );
  });

  it("returns undefined when a memory courier is empty", async () => {
    const courier = new MemoryCourier();

    await expect(
      courier.receive(),
    ).resolves.toBeUndefined();
  });

  it("sends and receives a capsule", async () => {
    const courier = new MemoryCourier();
    const capsule = createCapsule();

    await courier.send(capsule);

    await expect(
      courier.receive(),
    ).resolves.toEqual(capsule);
  });

  it("consumes the received envelope", async () => {
    const courier = new MemoryCourier();
    const capsule = createCapsule();

    await courier.send(capsule);

    await expect(
      courier.receive(),
    ).resolves.toEqual(capsule);

    await expect(
      courier.receive(),
    ).resolves.toBeUndefined();
  });

  it("does not expose the original capsule object", async () => {
    const courier = new MemoryCourier();
    const capsule = createCapsule();

    await courier.send(capsule);

    capsule.body.organic_results[0]!.title =
      "Modified After Send";

    const received =
      await courier.receive();

    expect(
      received?.body.organic_results[0]?.title,
    ).toBe("Government Hospital Bhopal");
  });

  it("returns an independent capsule object on receive", async () => {
    const courier = new MemoryCourier();
    const capsule = createCapsule();

    await courier.send(capsule);

    const received =
      await courier.receive();

    expect(received).toEqual(capsule);
    expect(received).not.toBe(capsule);
  });
});