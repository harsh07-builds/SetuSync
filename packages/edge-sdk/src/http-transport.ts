import type {
  Capsule,
  CapsuleRequest,
} from "@setusync/protocol";

import type { CapsuleTransport } from "./transport.js";

export interface HttpCapsuleTransportOptions {
  endpoint: string;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
}

export class HttpCapsuleTransport implements CapsuleTransport {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly headers: Record<string, string>;

  public constructor(options: HttpCapsuleTransportOptions) {
    if (!options.endpoint.trim()) {
      throw new Error("HTTP transport endpoint must not be empty.");
    }

    this.endpoint = options.endpoint;

    this.fetchImpl =
      options.fetchImpl ??
      globalThis.fetch.bind(globalThis);

    this.headers = {
      "content-type": "application/json",
      ...options.headers,
    };
  }

  public async fetchCapsule(
    request: CapsuleRequest,
  ): Promise<Capsule> {
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const responseText = await response.text();

      throw new Error(
        `Relay request failed with HTTP ${response.status}: ${
          responseText || response.statusText
        }`,
      );
    }

    return (await response.json()) as Capsule;
  }
}