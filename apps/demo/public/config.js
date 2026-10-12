// Runtime configuration. In Docker this file is regenerated at container
// start from the RELAY_URL environment variable, so one image works for
// every environment. Leave relayUrl empty to use the same origin
// (the bundled nginx proxies /v1/* to the relay).
window.__SETUSYNC_CONFIG__ = { relayUrl: "" };
