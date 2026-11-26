# Zen Multiverse multiplayer server (prototype, not deployed)

Cloudflare Worker + one Durable Object per world (hibernating WebSockets) + D1.
Sign-in with an emailed 6-digit code (Turnstile), friends, search, invites, visit/join,
server-validated movement with corrections, chat filter, block/report.

Run locally (no Cloudflare account needed):

```
cp .dev.vars.example .dev.vars
wrangler d1 migrations apply zen-mp --local
wrangler dev --local --port 8787 --ip 127.0.0.1
node test/two-clients.mjs
```

Then open the game with `?mp=1` in two browser profiles.
Going live needs a real D1 id, secrets and a domain; see the design notes.
