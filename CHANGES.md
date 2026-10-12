# What was fixed

## Root causes of the failures you saw

1. **“Relay capsule shape mismatch … containerNode, missingNode, bigDecimal …”**
   Spring Boot 4 serialises HTTP responses with Jackson 3 (`tools.jackson`);
   the Relay returns Jackson 2 `JsonNode` trees. Jackson 3 doesn't recognise
   them and dumped the *bean properties* of the node object. Fixed in
   `SearchController`, `CapsuleController` and `SyncController` (same bug) via
   `api/JsonResponses`, which renders Jackson 2 trees itself.
2. **Searches timing out.** `monthly-credit-budget` / `per-install-credit-quota`
   defaulted to `0`, which the governor treats as “not configured” → every
   uncached search denied → retried every 30 s forever → ticket stuck in
   `PROCESSING` → client gave up after 90 s. Defaults are now 240 / 40, and
   a refusal **fails the ticket immediately with a readable reason**.
3. **Silent failures.** Tickets now carry `failure_reason` (new column,
   `GET /v1/tickets/{id}` returns `reason`) for governor refusals, missing
   SerpApi key (checked before any credit is reserved), provider failures and
   stale submissions.
4. **Scheduler starvation.** One scheduler thread ran the dispatcher, poller,
   compiler and recovery worker; one slow provider call stalled all of them.
   Pool is now 4. Poll/compile intervals 5 s → 2 s; stale-submission recovery 120 s → 60 s.

## Deployability

- No code ever registered the signing key, so a fresh deployment could accept
  searches but never produce a capsule. `SigningKeyBootstrap` registers it from env.
- `application-prod.yml` had a duplicate YAML key (startup failure) and
  `sql.init.mode: never` with no migration path; both fixed.
- CORS was hard-coded to `localhost:5173`; now `SETUSYNC_CORS_ALLOWED_ORIGINS`.
- Multi-stage Dockerfiles (relay, web), nginx same-origin proxy,
  runtime `config.js`, full `docker-compose.yml`, `.env.example`,
  `scripts/generate-signing-key.mjs` (output verified loadable by Java's `KeyFactory`).
- `IllegalArgumentException` → HTTP 400 (was 500).

## SDK / demo

- New `RelayCapsuleTransport` (edge-sdk): speaks the Relay's real protocol
  (install-id header, idempotency key, 202 + ticket polling, envelope
  unwrapping), per-request timeouts, tolerates flaky links, typed `RelayError`
  with `retryable`. 13 tests in `packages/edge-sdk/test/relay-transport.test.ts`.
- Demo rewritten around the SDK's outbox + `SyncEngine`: offline requests are
  persisted and sent automatically on reconnect; freshness badges; readable
  errors with the relay's reason; auto-retry; no more state mutation during render.
  Logic lives in `apps/demo/src/controller.ts`.

---

# Round 2: offline-sharing features

New relay endpoint `GET /v1/keys` (publishes public signing keys).

New edge-sdk modules (all with tests in `packages/edge-sdk/test/sharing.test.ts`):
`query/normalize`, `keys/keyring` (trust-on-first-use, key-id pinning, fingerprints),
`pack/pack` (`.setupack`: gzip JSON, size and decompression-bomb limits, per-capsule
verification), `pack/qr-frames` (order-independent animated-QR framing with integrity hash),
`policy/volatility`, `stats/savings`, `chaos/network-chaos`.

Demo: share/receive panel (file, Web Share, QR send, camera QR scan, key-trust prompt),
provenance + volatility chips, impact dashboard, network lab, link-quality-triggered sync,
PWA (manifest, service worker, icons). Behaviour covered by `apps/demo/test/*.test.ts`.

Bug found by the tests and fixed: a corrupt or oversized pack left an unhandled promise
rejection from the decompression stream's writer side.

## Four more features

- **Delta capsules** (`packages/edge-sdk/src/delta`): only the changes between two signed capsules travel; the receiver rebuilds the exact capsule and the normal signature check proves it. "Share only changes" in the Share tab; automatic during nearby transfer.
- **Background Sync** (`packages/edge-sdk/src/bgsync`, `apps/demo/src/sw-bg.ts`): the service worker completes queued searches with the tab closed and parks the signed capsules in an inbox; the page verifies them on next open. Built to `dist/bg-sync.js` by `npm run build -w @setusync/demo`.
- **WebRTC peer transfer** (`packages/edge-sdk/src/p2p`, `P2PPanel.tsx`): QR-code signalling, no server, same Wi-Fi/hotspot. Only missing searches (or deltas) are exchanged, all through the verified import.
- **Smart search** (`packages/edge-sdk/src/semantic`, `semantic-embedder.ts`): transformers.js sentence model in the browser; ONNX runtime copied into `public/ort` by `scripts/copy-ort.mjs` so it works offline once the model is cached.
