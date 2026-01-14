# RPC Proxy

Minimal JSON-RPC proxy to avoid Cloudflare Workers egress blocks.

## Usage

```bash
export TARGET_RPC_URL="https://api.testnet.solana.com"
export AUTH_TOKEN="optional-shared-secret"
export PORT=8787
node server.js
```

Health check:

```bash
curl http://localhost:8787/health
```

If `AUTH_TOKEN` is set, the caller must include:

```
X-Auth-Token: <token>
```
