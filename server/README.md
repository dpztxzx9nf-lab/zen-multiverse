# Zen Multiverse multiplayer server

Cloudflare Worker + one Durable Object per world (hibernating WebSockets) + D1.
Sign-in with an emailed 6-digit code (Turnstile), friends, search, invites, visit/join,
server-validated movement (sphere-surface, no world borders), digging and building sync,
chat filter, block/report. Live host: `https://zen.thinkcore.io`.

Run locally (no Cloudflare account needed):

```
cp .dev.vars.example .dev.vars
wrangler d1 migrations apply zen-mp --local
wrangler dev --local --port 8787 --ip 127.0.0.1
node test/two-clients.mjs
```

The game client uses `http://127.0.0.1:8787` when opened on localhost, otherwise
`https://zen.thinkcore.io`. If the server is down the game still plays offline solo.
