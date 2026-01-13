# Privacy AMM - Cloudflare Deployment Guide

## Overview

This guide explains how to deploy the Privacy AMM to Cloudflare:
- **Relayer**: Cloudflare Workers (serverless backend)
- **Frontend**: Cloudflare Pages (static site)

## Prerequisites

1. [Cloudflare Account](https://dash.cloudflare.com/sign-up)
2. [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
3. Node.js 18+

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        User Browser                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Cloudflare Pages (Frontend)                     │
│              https://privacy-amm.pages.dev                   │
│                                                              │
│  - Wallet Connection (Phantom)                               │
│  - ZK Proof Generation (snarkjs in browser)                  │
│  - Transaction Status Display                                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│           Cloudflare Workers (Relayer)                       │
│           https://privacy-amm-relayer.workers.dev            │
│                                                              │
│  - Receives proofs from frontend                             │
│  - Builds Solana transactions                                │
│  - Submits to Solana Testnet                                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Solana Testnet                            │
│                                                              │
│  Program: 7DGg2ouvHsZecGDocaY1nu6ZmSDvSq9NsLSHd16ENHbQ      │
│                                                              │
│  - Verifies ZK proofs on-chain                               │
│  - Manages UTXO Merkle tree                                  │
│  - Executes private swaps/liquidity                          │
└─────────────────────────────────────────────────────────────┘
```

## Deploy Relayer (Cloudflare Workers)

### 1. Login to Cloudflare

```bash
cd relayer-js
npx wrangler login
```

### 2. Configure Secrets

```bash
# Generate a new Solana keypair for the relayer
solana-keygen new -o relayer-keypair.json

# Add the private key as a secret (optional - for gasless transactions)
npx wrangler secret put RELAYER_PRIVATE_KEY
# Paste the contents of relayer-keypair.json
```

### 3. Deploy

```bash
npm install
npx wrangler deploy
```

### 4. Verify Deployment

```bash
curl https://privacy-amm-relayer.<your-subdomain>.workers.dev/
```

Expected response:
```json
{
  "name": "Privacy AMM Relayer",
  "version": "0.1.0",
  "network": "testnet",
  "programId": "7DGg2ouvHsZecGDocaY1nu6ZmSDvSq9NsLSHd16ENHbQ"
}
```

## Deploy Frontend (Cloudflare Pages)

### Option 1: Git Integration (Recommended)

1. Push code to GitHub/GitLab
2. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) → Pages
3. Click "Create a project" → "Connect to Git"
4. Select your repository
5. Configure build settings:
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Root directory**: `frontend`

### Option 2: Direct Upload

```bash
cd frontend

# Install dependencies
npm install

# Build
npm run build

# Deploy with Wrangler
npx wrangler pages deploy dist --project-name=privacy-amm
```

### 3. Update Frontend Config

After deploying the relayer, update `frontend/src/main.js`:

```javascript
const CONFIG = {
    relayerUrl: 'https://privacy-amm-relayer.<your-subdomain>.workers.dev',
    // ...
};
```

Then redeploy the frontend.

## Environment Variables

### Relayer (wrangler.toml)

| Variable | Description | Default |
|----------|-------------|---------|
| `SOLANA_RPC_URL` | Solana RPC endpoint | `https://api.testnet.solana.com` |
| `PROGRAM_ID` | Privacy AMM program ID | `7DGg2ouvHsZecGDocaY1nu6ZmSDvSq9NsLSHd16ENHbQ` |

### Frontend

Configure in `src/main.js`:

| Variable | Description |
|----------|-------------|
| `CONFIG.relayerUrl` | Deployed relayer URL |
| `CONFIG.network` | `testnet` or `mainnet` |
| `CONFIG.programId` | Privacy AMM program ID |

## Custom Domain (Optional)

1. Go to Cloudflare Dashboard → your site → Custom domains
2. Add your domain (e.g., `privacy-amm.example.com`)
3. Update DNS records as instructed

## Testing

### Test Relayer

```bash
# Health check
curl https://privacy-amm-relayer.workers.dev/

# Get pool state
curl https://privacy-amm-relayer.workers.dev/pool

# Test deposit (mock)
curl -X POST https://privacy-amm-relayer.workers.dev/deposit \
  -H "Content-Type: application/json" \
  -d '{"commitment": "0x123", "amount": 1000000000, "assetType": 0}'
```

### Test Frontend

1. Open the deployed frontend URL
2. Connect Phantom wallet
3. Try a test swap

## Monitoring

### Cloudflare Analytics

- Workers: Dashboard → Workers → Analytics
- Pages: Dashboard → Pages → Analytics

### Logs

```bash
# View real-time logs
npx wrangler tail
```

## Troubleshooting

### CORS Issues

Ensure the relayer returns proper CORS headers:
```javascript
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};
```

### Wallet Not Connecting

1. Ensure you're using HTTPS
2. Check if Phantom is installed
3. Try clearing browser cache

### Transaction Failures

1. Check relayer logs: `npx wrangler tail`
2. Verify Solana RPC is accessible
3. Ensure program is deployed to testnet

## Security Considerations

1. **Relayer Key**: Store as Cloudflare secret, not in code
2. **Rate Limiting**: Consider adding rate limiting to relayer
3. **UTXO Privacy**: UTXOs are stored in browser localStorage
   - Consider encrypted storage for production
   - Never expose private keys to relayer

## Cost Estimation

### Cloudflare Workers (Free Tier)

- 100,000 requests/day
- 10ms CPU time per request
- Sufficient for testnet usage

### Cloudflare Pages (Free Tier)

- 500 builds/month
- Unlimited bandwidth
- Sufficient for most projects

## Next Steps

1. Add proper ZK proof generation in frontend
2. Implement real Solana transaction building in relayer
3. Add merkle tree synchronization
4. Consider adding a proper backend for UTXO storage
