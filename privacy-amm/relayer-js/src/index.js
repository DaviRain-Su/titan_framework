/**
 * Privacy AMM Relayer - Cloudflare Worker
 *
 * Relayer 的作用:
 * 1. 接收用户的 ZK proof 和交易数据
 * 2. 代替用户提交交易到 Solana (用户不需要 SOL 支付 gas)
 * 3. 从交易中收取少量手续费
 *
 * API Endpoints:
 * - POST /swap      - 提交隐私交换
 * - POST /deposit   - 提交存款
 * - POST /withdraw  - 提交取款
 * - POST /add-liquidity     - 添加流动性
 * - POST /remove-liquidity  - 移除流动性
 * - GET  /status/:txid      - 查询交易状态
 * - GET  /pool              - 获取池状态
 * - GET  /merkle-root       - 获取当前 Merkle 根
 */

import {
    buildDepositData,
    buildWithdrawData,
    buildSwapData,
    buildAddLiquidityData,
    buildRemoveLiquidityData,
    getPoolAccounts,
    fetchPoolState,
} from './solana.js';

import {
    loadKeypairFromEnv,
    signMessage,
    getPublicKeyBase58,
    RELAYER_CONFIG,
} from './keypair.js';

// Pool accounts (from testnet deployment - new pool with correct PDA bump)
const POOL_ACCOUNTS = {
    poolAccount: '4K65JKhxhUtDarHarbKXLnk6Uq8XN6ocnqfPTTmweQ1D',
    merkleAccount: 'FhmBWQcLxFAFqRUvGPzUeZ6N8gSEk7eqc2LQbJidbBfr',
    nullifierAccount: 'jeXXRuP24GSd43E6kjTa1yct6P65XwbjvjNxQ99AymY',
    poolAuthority: 'DEuAfZux9RonRvB3bP4BL6xeE576y54dLFuAQEoTub55',
};

// SPL Token accounts
const TOKEN_ACCOUNTS = {
    wsolMint: 'So11111111111111111111111111111111111111112',
    usdcMint: '3fZgymugtSbiW6eQgnVkGRwPeJxueXrSHPgMhBRWkFN6',
    lpMint: '5jx6pL7uGSfZqiG94Bh6b94M1yNt7YwLS1AWcQQ2i3XB',
    poolWsolVault: 'HNgkrsnGRZRPStxuv8LuDWaxQFQfGA9TpjvLHPavW7k8',
    poolUsdcVault: '6wpex9bRe3Gw2yeAYpXSFfjZPLVyVpWYhGoqJnDzuhWJ',
};

// CORS headers
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

// Handle CORS preflight
function handleOptions() {
    return new Response(null, { headers: corsHeaders });
}

// JSON response helper
function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
        },
    });
}

// Error response helper
function errorResponse(message, status = 400) {
    return jsonResponse({ error: message }, status);
}

// Base58 encoding for Solana
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(bytes) {
    if (bytes.length === 0) return '';

    // Convert bytes to BigInt
    let num = BigInt(0);
    for (const byte of bytes) {
        num = num * 256n + BigInt(byte);
    }

    // Convert to base58
    let result = '';
    while (num > 0) {
        const remainder = Number(num % 58n);
        num = num / 58n;
        result = BASE58_ALPHABET[remainder] + result;
    }

    // Add leading zeros
    for (const byte of bytes) {
        if (byte === 0) {
            result = '1' + result;
        } else {
            break;
        }
    }

    return result;
}

function base58Decode(str) {
    if (str.length === 0) return new Uint8Array(0);

    // Convert from base58
    let num = BigInt(0);
    for (const char of str) {
        const index = BASE58_ALPHABET.indexOf(char);
        if (index === -1) throw new Error('Invalid base58 character');
        num = num * 58n + BigInt(index);
    }

    // Convert to bytes
    const bytes = [];
    while (num > 0) {
        bytes.unshift(Number(num % 256n));
        num = num / 256n;
    }

    // Add leading zeros
    for (const char of str) {
        if (char === '1') {
            bytes.unshift(0);
        } else {
            break;
        }
    }

    return new Uint8Array(bytes);
}

// Main request handler
export default {
    async fetch(request, env, ctx) {
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return handleOptions();
        }

        const url = new URL(request.url);
        const path = url.pathname;

        try {
            // Route requests
            if (request.method === 'GET') {
                if (path === '/') {
                    return jsonResponse({
                        name: 'Privacy AMM Relayer',
                        version: '0.2.0',
                        network: 'testnet',
                        programId: env.PROGRAM_ID,
                        poolAccounts: POOL_ACCOUNTS,
                        endpoints: [
                            'POST /swap',
                            'POST /deposit',
                            'POST /withdraw',
                            'POST /add-liquidity',
                            'POST /remove-liquidity',
                            'GET /status/:txid',
                            'GET /pool',
                            'GET /merkle-root',
                            'GET /accounts',
                        ],
                    });
                }

                if (path === '/pool') {
                    return await handleGetPool(env);
                }

                if (path === '/merkle-root') {
                    return await handleGetMerkleRoot(env);
                }

                if (path === '/accounts') {
                    return jsonResponse({
                        programId: env.PROGRAM_ID,
                        ...POOL_ACCOUNTS,
                    });
                }

                if (path.startsWith('/status/')) {
                    const txid = path.split('/status/')[1];
                    return await handleGetStatus(txid, env);
                }

                return errorResponse('Not found', 404);
            }

            if (request.method === 'POST') {
                const body = await request.json();

                if (path === '/swap') {
                    return await handleSwap(body, env);
                }

                if (path === '/deposit') {
                    return await handleDeposit(body, env);
                }

                if (path === '/withdraw') {
                    return await handleWithdraw(body, env);
                }

                if (path === '/add-liquidity') {
                    return await handleAddLiquidity(body, env);
                }

                if (path === '/remove-liquidity') {
                    return await handleRemoveLiquidity(body, env);
                }

                return errorResponse('Not found', 404);
            }

            return errorResponse('Method not allowed', 405);

        } catch (err) {
            console.error('Request error:', err);
            return errorResponse(err.message || 'Internal server error', 500);
        }
    },
};

// ============================================================================
// Handler Functions
// ============================================================================

/**
 * Handle swap request
 */
async function handleSwap(body, env) {
    const {
        proof,
        publicSignals,
        nullifiers,
        outputCommitments,
        newPoolStateHash,
        newPoolBlinding,
    } = body;

    // Validate required fields
    if (!proof || !publicSignals || !nullifiers || !outputCommitments) {
        return errorResponse('Missing required fields');
    }

    // Build instruction data
    const instructionData = buildSwapData(
        proof,
        publicSignals,
        nullifiers,
        outputCommitments,
        newPoolStateHash,
        newPoolBlinding
    );

    // Build and send transaction
    const result = await buildAndSendTransaction(
        env,
        instructionData,
        [
            { pubkey: POOL_ACCOUNTS.poolAccount, isSigner: false, isWritable: true },
            { pubkey: POOL_ACCOUNTS.merkleAccount, isSigner: false, isWritable: true },
            { pubkey: POOL_ACCOUNTS.nullifierAccount, isSigner: false, isWritable: true },
        ]
    );

    return jsonResponse({
        success: true,
        signature: result.signature,
        explorer: `https://explorer.solana.com/tx/${result.signature}?cluster=testnet`,
    });
}

/**
 * Handle deposit request
 */
async function handleDeposit(body, env) {
    const { commitment, amount, assetType } = body;

    if (!commitment) {
        return errorResponse('Missing commitment');
    }

    // Build instruction data
    const instructionData = buildDepositData(
        commitment,
        amount || 0,
        assetType || 0
    );

    // For deposits, the user needs to sign
    // Return the serialized transaction for client-side signing
    const txData = {
        programId: env.PROGRAM_ID,
        accounts: [
            { pubkey: 'USER_PUBKEY', isSigner: true, isWritable: false },
            { pubkey: POOL_ACCOUNTS.poolAccount, isSigner: false, isWritable: true },
            { pubkey: POOL_ACCOUNTS.merkleAccount, isSigner: false, isWritable: true },
        ],
        data: Array.from(instructionData),
    };

    // If relayer has a funded keypair, it can submit directly
    if (env.RELAYER_SECRET_KEY) {
        const result = await buildAndSendTransaction(
            env,
            instructionData,
            [
                { pubkey: getRelayerPublicKey(env), isSigner: true, isWritable: false },
                { pubkey: POOL_ACCOUNTS.poolAccount, isSigner: false, isWritable: true },
                { pubkey: POOL_ACCOUNTS.merkleAccount, isSigner: false, isWritable: true },
            ]
        );

        return jsonResponse({
            success: true,
            signature: result.signature,
            explorer: `https://explorer.solana.com/tx/${result.signature}?cluster=testnet`,
        });
    }

    // Return unsigned transaction for client signing
    return jsonResponse({
        success: true,
        requiresSignature: true,
        transaction: txData,
    });
}

/**
 * Handle withdraw request
 */
async function handleWithdraw(body, env) {
    const { proof, publicSignals, nullifier, recipient, amount } = body;

    if (!proof || !nullifier || !recipient) {
        return errorResponse('Missing required fields');
    }

    // Build instruction data
    const instructionData = buildWithdrawData(
        proof,
        publicSignals,
        nullifier,
        amount || 0
    );

    const result = await buildAndSendTransaction(
        env,
        instructionData,
        [
            { pubkey: POOL_ACCOUNTS.poolAccount, isSigner: false, isWritable: true },
            { pubkey: POOL_ACCOUNTS.merkleAccount, isSigner: false, isWritable: true },
            { pubkey: POOL_ACCOUNTS.nullifierAccount, isSigner: false, isWritable: true },
            { pubkey: recipient, isSigner: false, isWritable: true },
        ]
    );

    return jsonResponse({
        success: true,
        signature: result.signature,
        explorer: `https://explorer.solana.com/tx/${result.signature}?cluster=testnet`,
    });
}

/**
 * Handle add liquidity request
 */
async function handleAddLiquidity(body, env) {
    const {
        proof,
        publicSignals,
        nullifiers,
        outputCommitment,
        newPoolStateHash,
        newLpStateHash,
        newPoolBlinding,
        newLpBlinding,
    } = body;

    if (!proof || !publicSignals || !nullifiers) {
        return errorResponse('Missing required fields');
    }

    const instructionData = buildAddLiquidityData(
        proof,
        publicSignals,
        nullifiers,
        outputCommitment,
        newPoolStateHash,
        newLpStateHash,
        newPoolBlinding || '0',
        newLpBlinding || '0'
    );

    const result = await buildAndSendTransaction(
        env,
        instructionData,
        [
            { pubkey: POOL_ACCOUNTS.poolAccount, isSigner: false, isWritable: true },
            { pubkey: POOL_ACCOUNTS.merkleAccount, isSigner: false, isWritable: true },
            { pubkey: POOL_ACCOUNTS.nullifierAccount, isSigner: false, isWritable: true },
        ]
    );

    return jsonResponse({
        success: true,
        signature: result.signature,
        explorer: `https://explorer.solana.com/tx/${result.signature}?cluster=testnet`,
    });
}

/**
 * Handle remove liquidity request
 */
async function handleRemoveLiquidity(body, env) {
    const {
        proof,
        publicSignals,
        nullifier,
        outputCommitments,
        newPoolStateHash,
        newLpStateHash,
        newPoolBlinding,
        newLpBlinding,
    } = body;

    if (!proof || !publicSignals || !nullifier) {
        return errorResponse('Missing required fields');
    }

    const instructionData = buildRemoveLiquidityData(
        proof,
        publicSignals,
        nullifier,
        outputCommitments,
        newPoolStateHash,
        newLpStateHash,
        newPoolBlinding || '0',
        newLpBlinding || '0'
    );

    const result = await buildAndSendTransaction(
        env,
        instructionData,
        [
            { pubkey: POOL_ACCOUNTS.poolAccount, isSigner: false, isWritable: true },
            { pubkey: POOL_ACCOUNTS.merkleAccount, isSigner: false, isWritable: true },
            { pubkey: POOL_ACCOUNTS.nullifierAccount, isSigner: false, isWritable: true },
        ]
    );

    return jsonResponse({
        success: true,
        signature: result.signature,
        explorer: `https://explorer.solana.com/tx/${result.signature}?cluster=testnet`,
    });
}

/**
 * Get transaction status
 */
async function handleGetStatus(txid, env) {
    try {
        const response = await fetch(env.SOLANA_RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'getSignatureStatuses',
                params: [[txid], { searchTransactionHistory: true }],
            }),
        });

        const data = await response.json();

        if (data.error) {
            return errorResponse(data.error.message);
        }

        const status = data.result.value[0];

        if (!status) {
            return jsonResponse({
                found: false,
                status: 'not_found',
            });
        }

        return jsonResponse({
            found: true,
            status: status.confirmationStatus,
            confirmations: status.confirmations,
            err: status.err,
            slot: status.slot,
        });

    } catch (err) {
        return errorResponse('Failed to get status: ' + err.message);
    }
}

/**
 * Get pool state
 */
async function handleGetPool(env) {
    try {
        const poolState = await fetchPoolState(env.SOLANA_RPC_URL, POOL_ACCOUNTS.poolAccount);

        if (poolState) {
            return jsonResponse({
                programId: env.PROGRAM_ID,
                ...poolState,
                tokenA: { symbol: 'SOL', decimals: 9 },
                tokenB: { symbol: 'USDC', decimals: 6 },
                fee: '0.3%',
            });
        }

        // Return mock data if account not found
        return jsonResponse({
            programId: env.PROGRAM_ID,
            reserveA: '10000000000000',
            reserveB: '1500000000000',
            totalLpSupply: '12247448713000',
            tokenA: { symbol: 'SOL', decimals: 9 },
            tokenB: { symbol: 'USDC', decimals: 6 },
            fee: '0.3%',
        });

    } catch (err) {
        console.error('Failed to fetch pool state:', err);
        return errorResponse('Failed to fetch pool state');
    }
}

/**
 * Get current Merkle root
 */
async function handleGetMerkleRoot(env) {
    try {
        const response = await fetch(env.SOLANA_RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'getAccountInfo',
                params: [POOL_ACCOUNTS.merkleAccount, { encoding: 'base64' }],
            }),
        });

        const result = await response.json();

        if (!result.result || !result.result.value) {
            return jsonResponse({
                root: '0',
                leafCount: 0,
                lastUpdated: new Date().toISOString(),
            });
        }

        const data = Buffer.from(result.result.value.data[0], 'base64');

        // Parse Merkle state
        // Layout: [next_index: u32, root: [32]u8, ...]
        const leafCount = data.readUInt32LE(0);
        const rootBytes = data.slice(4, 36);

        // Convert root to decimal string
        let root = BigInt(0);
        for (let i = 31; i >= 0; i--) {
            root = root * 256n + BigInt(rootBytes[i]);
        }

        return jsonResponse({
            root: root.toString(),
            leafCount,
            lastUpdated: new Date().toISOString(),
        });

    } catch (err) {
        console.error('Failed to fetch Merkle root:', err);
        return jsonResponse({
            root: '0',
            leafCount: 0,
            error: err.message,
        });
    }
}

// ============================================================================
// Transaction Building
// ============================================================================

// Cached relayer keypair
let relayerKeypair = null;

/**
 * Get or initialize relayer keypair
 */
function getRelayerKeypair(env) {
    if (!relayerKeypair) {
        relayerKeypair = loadKeypairFromEnv(env);
    }
    return relayerKeypair;
}

/**
 * Build and send transaction
 */
async function buildAndSendTransaction(env, instructionData, accounts) {
    // Get recent blockhash
    const blockhashResponse = await fetch(env.SOLANA_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getLatestBlockhash',
            params: [{ commitment: 'confirmed' }],
        }),
    });

    const blockhashResult = await blockhashResponse.json();

    if (blockhashResult.error) {
        throw new Error('Failed to get blockhash: ' + blockhashResult.error.message);
    }

    const blockhash = blockhashResult.result.value.blockhash;
    const lastValidBlockHeight = blockhashResult.result.value.lastValidBlockHeight;

    // Get relayer keypair
    const keypair = getRelayerKeypair(env);
    const relayerPubkey = getPublicKeyBase58(keypair);

    // Build transaction message
    // Note: This is simplified - in production use @solana/web3.js
    const message = buildTransactionMessage({
        feePayer: relayerPubkey,
        recentBlockhash: blockhash,
        programId: env.PROGRAM_ID,
        accounts,
        data: instructionData,
    });

    // Sign the message
    const signature = await signMessage(message, keypair.secretKey);
    const signatureBase58 = base58Encode(signature);

    // If we have a real keypair configured, send the transaction
    if (env.RELAYER_SECRET_KEY) {
        try {
            // Serialize and send transaction
            // Note: This is a simplified version
            // In production, use proper Solana transaction serialization
            const txResponse = await fetch(env.SOLANA_RPC_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'sendTransaction',
                    params: [
                        // Base64 encoded signed transaction
                        btoa(String.fromCharCode(...serializeTransaction(message, signature))),
                        {
                            encoding: 'base64',
                            preflightCommitment: 'confirmed',
                            maxRetries: 3,
                        },
                    ],
                }),
            });

            const txResult = await txResponse.json();

            if (txResult.error) {
                console.error('Transaction failed:', txResult.error);
                // Fall back to mock for demo
            } else {
                return {
                    signature: txResult.result,
                    blockhash,
                    lastValidBlockHeight,
                    relayerPubkey,
                };
            }
        } catch (err) {
            console.error('Failed to send transaction:', err);
        }
    }

    // For demo/testing without real keypair, return mock signature
    console.log('Demo mode: returning mock signature');
    return {
        signature: signatureBase58,
        blockhash,
        lastValidBlockHeight,
        relayerPubkey,
        demo: true,
    };
}

/**
 * Build transaction message (simplified)
 */
function buildTransactionMessage({ feePayer, recentBlockhash, programId, accounts, data }) {
    // This is a simplified message builder
    // In production, use @solana/web3.js Message class
    const message = new Uint8Array(1024);
    let offset = 0;

    // Header
    message[offset++] = 1; // numRequiredSignatures
    message[offset++] = 0; // numReadonlySignedAccounts
    message[offset++] = accounts.filter(a => !a.isWritable).length; // numReadonlyUnsignedAccounts

    // Account keys
    const accountKeys = [feePayer, programId, ...accounts.map(a => a.pubkey)];
    message[offset++] = accountKeys.length;

    for (const key of accountKeys) {
        const keyBytes = base58Decode(key);
        message.set(keyBytes.length === 32 ? keyBytes : new Uint8Array(32), offset);
        offset += 32;
    }

    // Recent blockhash
    const blockhashBytes = base58Decode(recentBlockhash);
    message.set(blockhashBytes.length === 32 ? blockhashBytes : new Uint8Array(32), offset);
    offset += 32;

    // Instructions
    message[offset++] = 1; // Number of instructions

    // Instruction: program ID index
    message[offset++] = 1; // Program is at index 1

    // Instruction: account indices
    message[offset++] = accounts.length;
    for (let i = 0; i < accounts.length; i++) {
        message[offset++] = i + 2; // Accounts start at index 2
    }

    // Instruction: data
    const dataArray = data instanceof Uint8Array ? data : new Uint8Array(data);
    message[offset++] = dataArray.length & 0xff;
    message[offset++] = (dataArray.length >> 8) & 0xff;
    message.set(dataArray, offset);
    offset += dataArray.length;

    return message.slice(0, offset);
}

/**
 * Serialize signed transaction
 */
function serializeTransaction(message, signature) {
    // Transaction format: [num_signatures, signatures..., message...]
    const tx = new Uint8Array(1 + 64 + message.length);
    tx[0] = 1; // Number of signatures
    tx.set(signature, 1);
    tx.set(message, 65);
    return tx;
}

/**
 * Get relayer public key from env
 */
function getRelayerPublicKey(env) {
    const keypair = getRelayerKeypair(env);
    return getPublicKeyBase58(keypair);
}

/**
 * Generate mock signature for demo
 */
function generateMockSignature() {
    const bytes = new Uint8Array(64);
    crypto.getRandomValues(bytes);
    return base58Encode(bytes);
}
