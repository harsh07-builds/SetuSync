# Setu Node: a community hub on spare hardware

One weak uplink can serve a whole village if a device on the local network
holds the results. Run the Relay and the web app on any spare laptop (or a
small PC), turn on its Wi-Fi hotspot, and everyone nearby searches through it.

```
phones ──Wi-Fi──► hub laptop (relay + app + cache) ──weak 2G/3G, whenever up──► SerpApi
```

## Setup

1. Install Docker on the laptop, copy the project, create `.env` (see README).
2. `docker compose up -d --build`
3. Turn on the laptop's hotspot. Note its address, e.g. `192.168.137.1`.
4. Phones join the hotspot and open `http://192.168.137.1:8089`.

Searches already on the hub cost no uplink at all. New searches use the
uplink only when it is available and queue in the meantime (the relay keeps
the request, the phone keeps its outbox).

## Important: what needs HTTPS

Browsers only enable some features on `https://` or `http://localhost`:

| Feature | Plain `http://192.168.x.x` | HTTPS or localhost |
|---|---|---|
| Search, cache, outbox, pack import/export (file) | works | works |
| Pack verification, provenance | works | works |
| Camera QR scanning | **blocked** | works |
| Share sheet (WhatsApp etc.) | **blocked** | works |
| Install as app / offline app shell | **blocked** | works |

For a hub, put a TLS-terminating proxy in front. With Caddy and an internal
certificate authority:

```
# Caddyfile
192.168.137.1 {
    tls internal
    reverse_proxy localhost:8089
}
```

Phones must trust Caddy's root certificate once (Caddy prints where it is).
When the hub has internet, a free Cloudflare quick tunnel
(`cloudflared tunnel --url http://localhost:8089`) gives a real HTTPS URL
without installing a certificate.

## Keeping it healthy

- Set `SETUSYNC_GOVERNOR_MONTHLY_CREDIT_BUDGET` to your SerpApi plan so the
  hub can never overspend.
- Back up the `setusync_*_capsule_data` and Postgres volumes if the cached
  results matter.
- Anyone can carry results between hubs: *Share → Save as file*, hand over a
  USB drive or send on WhatsApp, *Import file* on the other side. Signatures
  are checked on arrival.
