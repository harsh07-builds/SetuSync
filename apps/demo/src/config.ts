interface RuntimeConfig {
  relayUrl?: string;
}

declare global {
  interface Window {
    __SETUSYNC_CONFIG__?: RuntimeConfig;
  }
}

/**
 * Where the Relay lives.
 *
 * Precedence: runtime config.js  >  VITE_SETUSYNC_RELAY_URL  >  default.
 * An empty string is meaningful: it selects the same origin, which is
 * what the Docker image uses (nginx proxies /v1/* to the Relay).
 */
function resolveRelayUrl(): string {
  const runtime = window.__SETUSYNC_CONFIG__?.relayUrl;

  if (typeof runtime === "string" && runtime.trim() !== "") {
    return runtime.trim();
  }

  const built = import.meta.env.VITE_SETUSYNC_RELAY_URL?.trim();

  if (built) {
    return built;
  }

  // Served by Vite on a dev port: the Relay is the Spring app on 8080.
  if (import.meta.env.DEV) {
    return "http://localhost:8080";
  }

  return "";
}

export const appConfig = {
  relayUrl: resolveRelayUrl(),
} as const;
