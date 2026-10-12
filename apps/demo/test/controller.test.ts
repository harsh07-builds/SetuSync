import { describe, expect, it } from "vitest";

import { makeDevice, makeRelay, settled, waitFor } from "./helpers.js";

describe("SetuSyncController: offline-first flow", () => {
  it("fetches online, saves on device, then searches locally", async () => {
    const relay = makeRelay();
    const device = makeDevice(relay);
    await device.init();

    expect(await device.requestLive("best cafe in Tokyo")).toBe(
      "QUEUED_SYNCING",
    );
    expect(await settled(device, 1)).toBe(true);

    expect(device.getState().outbox.length).toBe(0);
    expect(device.getState().notice?.kind).toBe("success");

    const view = device.searchLocal("cafe tokyo");
    expect(view.state).toBe("RESULTS");
    expect(view.hits[0]?.freshness?.state).toBe("FRESH");

    // Same search again is served from the device, no relay call.
    const before = relay.log.length;
    expect(await device.requestLive("Best  cafe in tokyo")).toBe(
      "FRESH_IN_CACHE",
    );
    expect(relay.log.length).toBe(before);
    device.dispose();
  });

  it("keeps requests made offline and syncs them on reconnect", async () => {
    const relay = makeRelay();
    const device = makeDevice(relay);
    await device.init();
    await waitFor(() => relay.log.length > 0); // key fetch finished
    relay.log.length = 0;

    device.setSimulatedOffline(true);
    expect(device.getState().online).toBe(false);
    expect(await device.requestLive("ramen in Osaka")).toBe("QUEUED_OFFLINE");
    expect(device.getState().outbox.length).toBe(1);
    expect(relay.log.length).toBe(0);

    device.setSimulatedOffline(false);
    expect(await settled(device, 1)).toBe(true);
    expect(device.getState().outbox.length).toBe(0);

    device.setSimulatedOffline(true);
    expect(device.searchLocal("ramen osaka").hits.length).toBeGreaterThan(0);
    device.dispose();
  });

  it("shows the relay's reason when it refuses a search", async () => {
    const device = makeDevice(makeRelay("budget"));
    await device.init();
    await device.requestLive("pizza");

    expect(
      await waitFor(() => device.getState().outbox[0]?.status === "FAILED"),
    ).toBe(true);
    expect(device.getState().outbox[0]?.lastError).toContain(
      "budget is used up",
    );
    expect(device.getState().notice?.kind).toBe("error");
    device.dispose();
  });

  it("survives an unreachable relay and retries successfully", async () => {
    const relay = makeRelay("down");
    const device = makeDevice(relay);
    await device.init();
    await device.requestLive("tea");

    expect(
      await waitFor(() => device.getState().outbox[0]?.status === "FAILED"),
    ).toBe(true);
    expect(device.getState().relayReachable).toBe(false);
    expect(device.getState().notice?.text).toContain("retry automatically");

    relay.mode = "ok";
    const id = device.getState().outbox[0]?.id;
    expect(id).toBeDefined();
    await device.retry(id as string);

    expect(await settled(device, 1)).toBe(true);
    expect(device.getState().relayReachable).toBe(true);
    device.dispose();
  });

  it("is safe under React StrictMode (dispose then init)", async () => {
    const device = makeDevice(makeRelay());
    await device.init();
    device.dispose();
    await device.init();
    await device.requestLive("coffee");

    expect(await settled(device, 1)).toBe(true);
    device.dispose();
  });
});
