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
                        version: '0.1.0',
                        network: 'testnet',
                        programId: env.PROGRAM_ID,
                        endpoints: [
                            'POST /swap',
                            'POST /deposit',
                            'POST /withdraw',
                            'POST /add-liquidity',
                            'POST /remove-liquidity',
                            'GET /status/:txid',
                            'GET /pool',
                            'GET /merkle-root',
                        ],
                    });
                }

                if (path === '/pool') {
                    return await handleGetPool(env);
                }

                if (path === '/merkle-root') {
                    return await handleGetMerkleRoot(env);
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
 * Body: { proof, publicSignals, nullifiers, commitments, ... }
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

    // Build transaction
    const txData = {
        type: 'swap',
        proof,
        publicSignals,
        nullifiers,
        outputCommitments,
        newPoolStateHash,
        newPoolBlinding,
    };

    // Submit to Solana
    const result = await submitTransaction(txData, env);

    return jsonResponse({
        success: true,
        signature: result.signature,
        explorer: `https://explorer.solana.com/tx/${result.signature}?cluster=testnet`,
    });
}

/**
 * Handle deposit request
 * Body: { commitment, amount, assetType }
 */
async function handleDeposit(body, env) {
    const { commitment, amount, assetType } = body;

    if (!commitment) {
        return errorResponse('Missing commitment');
    }

    const txData = {
        type: 'deposit',
        commitment,
        amount: amount || 0,
        assetType: assetType || 0,
    };

    const result = await submitTransaction(txData, env);

    return jsonResponse({
        success: true,
        signature: result.signature,
        explorer: `https://explorer.solana.com/tx/${result.signature}?cluster=testnet`,
    });
}

/**
 * Handle withdraw request
 * Body: { proof, publicSignals, nullifier, recipient, amount }
 */
async function handleWithdraw(body, env) {
    const { proof, publicSignals, nullifier, recipient, amount } = body;

    if (!proof || !nullifier || !recipient) {
        return errorResponse('Missing required fields');
    }

    const txData = {
        type: 'withdraw',
        proof,
        publicSignals,
        nullifier,
        recipient,
        amount,
    };

    const result = await submitTransaction(txData, env);

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
    } = body;

    if (!proof || !publicSignals || !nullifiers) {
        return errorResponse('Missing required fields');
    }

    const txData = {
        type: 'add-liquidity',
        proof,
        publicSignals,
        nullifiers,
        outputCommitment,
        newPoolStateHash,
        newLpStateHash,
    };

    const result = await submitTransaction(txData, env);

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
    } = body;

    if (!proof || !publicSignals || !nullifier) {
        return errorResponse('Missing required fields');
    }

    const txData = {
        type: 'remove-liquidity',
        proof,
        publicSignals,
        nullifier,
        outputCommitments,
        newPoolStateHash,
        newLpStateHash,
    };

    const result = await submitTransaction(txData, env);

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
    // TODO: Fetch actual pool state from on-chain account
    // For now, return mock data
    return jsonResponse({
        programId: env.PROGRAM_ID,
        reserveA: '10000000000',
        reserveB: '15000000000',
        totalLpSupply: '12247448713',
        tokenA: {
            symbol: 'SOL',
            decimals: 9,
        },
        tokenB: {
            symbol: 'USDC',
            decimals: 6,
        },
        fee: '0.3%',
    });
}

/**
 * Get current Merkle root
 */
async function handleGetMerkleRoot(env) {
    // TODO: Fetch actual Merkle root from on-chain account
    // For now, return mock data
    return jsonResponse({
        root: '12345678901234567890123456789012345678901234567890',
        leafCount: 100,
        lastUpdated: new Date().toISOString(),
    });
}

// ============================================================================
// Transaction Submission
// ============================================================================

/**
 * Submit transaction to Solana
 * In production, this would use the relayer's keypair to sign and send
 */
async function submitTransaction(txData, env) {
    // For demo purposes, we'll just simulate the transaction
    // In production, you would:
    // 1. Build the actual Solana transaction
    // 2. Sign with relayer keypair (from env.RELAYER_PRIVATE_KEY)
    // 3. Send via RPC

    console.log('Submitting transaction:', txData.type);

    // Simulate transaction submission
    // In production, replace with actual Solana transaction submission
    const mockSignature = generateMockSignature();

    return {
        signature: mockSignature,
        slot: 12345678,
    };
}

/**
 * Generate mock signature for demo
 */
function generateMockSignature() {
    const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let result = '';
    for (let i = 0; i < 88; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert decimal string to 32-byte buffer (little-endian)
 */
function decimalTo32Bytes(decimal) {
    const bytes = new Uint8Array(32);
    let value = BigInt(decimal);
    for (let i = 0; i < 32; i++) {
        bytes[i] = Number(value & 0xFFn);
        value >>= 8n;
    }
    return bytes;
}

/**
 * Convert proof to bytes for Solana
 */
function proofToBytes(proof) {
    // G1 point to 64 bytes
    function g1ToBytes(point) {
        const bytes = new Uint8Array(64);
        const x = BigInt(point[0]);
        const y = BigInt(point[1]);
        for (let i = 0; i < 32; i++) {
            bytes[i] = Number((x >> BigInt(i * 8)) & 0xFFn);
            bytes[32 + i] = Number((y >> BigInt(i * 8)) & 0xFFn);
        }
        return bytes;
    }

    // G2 point to 128 bytes
    function g2ToBytes(point) {
        const bytes = new Uint8Array(128);
        const coords = [
            BigInt(point[0][0]),
            BigInt(point[0][1]),
            BigInt(point[1][0]),
            BigInt(point[1][1]),
        ];
        for (let c = 0; c < 4; c++) {
            for (let i = 0; i < 32; i++) {
                bytes[c * 32 + i] = Number((coords[c] >> BigInt(i * 8)) & 0xFFn);
            }
        }
        return bytes;
    }

    const pi_a = g1ToBytes(proof.pi_a);
    const pi_b = g2ToBytes(proof.pi_b);
    const pi_c = g1ToBytes(proof.pi_c);

    const result = new Uint8Array(256);
    result.set(pi_a, 0);
    result.set(pi_b, 64);
    result.set(pi_c, 192);
    return result;
}
