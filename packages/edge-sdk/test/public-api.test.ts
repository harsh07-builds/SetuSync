import { describe, expect, it } from "vitest";
import * as sdk from "../src/index.js";

describe("@setusync/edge-sdk public API", () => {
  it("exports everything needed to construct a SyncEngine", () => {
    expect(sdk.SyncEngine).toBeTypeOf("function");
    expect(sdk.IndexedDbCapsuleStore).toBeTypeOf("function");
    expect(sdk.IndexedDbMetadataStore).toBeTypeOf("function");
    expect(sdk.IndexedDbOutboxStore).toBeTypeOf("function");
    expect(sdk.IndexedDbSyncStateStore).toBeTypeOf("function");
    expect(sdk.CapsuleVerifier).toBeTypeOf("function");
    expect(sdk.RelayCapsuleTransport).toBeTypeOf("function");
  });
});
