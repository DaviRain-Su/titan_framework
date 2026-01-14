/**
 * Solana Transaction Builder
 * Builds and submits real Solana transactions
 */

// Instruction discriminators (must match lib.zig)
const INSTRUCTIONS = {
    Initialize: 0,
    Deposit: 1,
    Withdraw: 2,
    Swap: 3,
    PublicSwap: 4,
    AddLiquidity: 5,
    RemoveLiquidity: 6,
    PrivateAddLiquidity: 7,
    PrivateRemoveLiquidity: 8,
};

/**
 * Convert decimal string to 32-byte little-endian array
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
 * Convert number to 8-byte little-endian array (u64)
 */
function numberTo8Bytes(num) {
    const bytes = new Uint8Array(8);
    let value = BigInt(num);
    for (let i = 0; i < 8; i++) {
        bytes[i] = Number(value & 0xFFn);
        value >>= 8n;
    }
    return bytes;
}

/**
 * Concatenate Uint8Arrays
 */
function concat(...arrays) {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}

/**
 * Build deposit instruction data
 */
export function buildDepositData(commitment, amount, assetType) {
    return concat(
        new Uint8Array([INSTRUCTIONS.Deposit]),
        decimalTo32Bytes(commitment),
        numberTo8Bytes(amount),
        new Uint8Array([assetType])
    );
}

/**
 * Build withdraw instruction data
 */
export function buildWithdrawData(root, nullifier, amount, assetType) {
    return concat(
        new Uint8Array([INSTRUCTIONS.Withdraw]),
        decimalTo32Bytes(root),
        decimalTo32Bytes(nullifier),
        numberTo8Bytes(amount),
        new Uint8Array([assetType])
    );
}

/**
 * Build swap instruction data
 */
export function buildSwapData(
    proof,
    publicSignals,
    nullifiers,
    outputCommitments,
    newPoolStateHash,
    newPoolBlinding
) {
    const proofBytes = formatProofBytes(proof);
    const signalsBytes = formatSignalsBytes(publicSignals);

    return concat(
        new Uint8Array([INSTRUCTIONS.Swap]),
        proofBytes,
        signalsBytes,
        decimalTo32Bytes(nullifiers[0]),
        decimalTo32Bytes(nullifiers[1]),
        decimalTo32Bytes(outputCommitments[0]),
        decimalTo32Bytes(outputCommitments[1]),
        decimalTo32Bytes(newPoolStateHash),
        decimalTo32Bytes(newPoolBlinding)
    );
}

/**
 * Build add liquidity instruction data
 */
export function buildAddLiquidityData(
    proof,
    publicSignals,
    nullifiers,
    outputCommitment,
    newPoolStateHash,
    newLpStateHash,
    newPoolBlinding,
    newLpBlinding
) {
    const proofBytes = formatProofBytes(proof);
    const signalsBytes = formatSignalsBytes(publicSignals);

    return concat(
        new Uint8Array([INSTRUCTIONS.PrivateAddLiquidity]),
        proofBytes,
        signalsBytes,
        decimalTo32Bytes(nullifiers[0]),
        decimalTo32Bytes(nullifiers[1]),
        decimalTo32Bytes(outputCommitment),
        decimalTo32Bytes(newPoolStateHash),
        decimalTo32Bytes(newLpStateHash),
        decimalTo32Bytes(newPoolBlinding),
        decimalTo32Bytes(newLpBlinding)
    );
}

/**
 * Build remove liquidity instruction data
 */
export function buildRemoveLiquidityData(
    proof,
    publicSignals,
    nullifier,
    outputCommitments,
    newPoolStateHash,
    newLpStateHash,
    newPoolBlinding,
    newLpBlinding
) {
    const proofBytes = formatProofBytes(proof);
    const signalsBytes = formatSignalsBytes(publicSignals);

    return concat(
        new Uint8Array([INSTRUCTIONS.PrivateRemoveLiquidity]),
        proofBytes,
        signalsBytes,
        decimalTo32Bytes(nullifier),
        decimalTo32Bytes(outputCommitments[0]),
        decimalTo32Bytes(outputCommitments[1]),
        decimalTo32Bytes(newPoolStateHash),
        decimalTo32Bytes(newLpStateHash),
        decimalTo32Bytes(newPoolBlinding),
        decimalTo32Bytes(newLpBlinding)
    );
}

/**
 * Format proof to bytes (256 bytes)
 */
function formatProofBytes(proof) {
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

    return concat(
        g1ToBytes(proof.pi_a),
        g2ToBytes(proof.pi_b),
        g1ToBytes(proof.pi_c)
    );
}

/**
 * Format public signals to bytes
 */
function formatSignalsBytes(publicSignals) {
    const bytes = new Uint8Array(publicSignals.length * 32);
    for (let i = 0; i < publicSignals.length; i++) {
        let val = BigInt(publicSignals[i]);
        for (let j = 0; j < 32; j++) {
            bytes[i * 32 + j] = Number((val >> BigInt(j * 8)) & 0xFFn);
        }
    }
    return bytes;
}

/**
 * Create transaction with instruction
 */
export async function createTransaction(rpcUrl, programId, accounts, data, payer, headers = { 'Content-Type': 'application/json' }) {
    // Fetch recent blockhash
    const blockhashResponse = await fetch(rpcUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getLatestBlockhash',
            params: [{ commitment: 'confirmed' }],
        }),
    });

    const blockhashResult = await blockhashResponse.json();
    const blockhash = blockhashResult.result.value.blockhash;

    // Build instruction
    const instruction = {
        programId,
        keys: accounts,
        data: Buffer.from(data).toString('base64'),
    };

    // Build transaction
    // This is a simplified version - in production use @solana/web3.js
    const transaction = {
        recentBlockhash: blockhash,
        feePayer: payer,
        instructions: [instruction],
    };

    return transaction;
}

/**
 * Send transaction via RPC
 */
export async function sendTransaction(rpcUrl, signedTransaction, headers = { 'Content-Type': 'application/json' }) {
    const response = await fetch(rpcUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'sendTransaction',
            params: [
                signedTransaction,
                { encoding: 'base64', preflightCommitment: 'confirmed' },
            ],
        }),
    });

    const result = await response.json();

    if (result.error) {
        throw new Error(result.error.message);
    }

    return result.result;
}

/**
 * Confirm transaction
 */
export async function confirmTransaction(rpcUrl, signature, timeout = 30000, headers = { 'Content-Type': 'application/json' }) {
    const start = Date.now();

    while (Date.now() - start < timeout) {
        const response = await fetch(rpcUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'getSignatureStatuses',
                params: [[signature]],
            }),
        });

        const result = await response.json();
        const status = result.result.value[0];

        if (status) {
            if (status.err) {
                throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
            }
            if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
                return status;
            }
        }

        await new Promise(r => setTimeout(r, 1000));
    }

    throw new Error('Transaction confirmation timeout');
}

/**
 * Get pool accounts from on-chain
 */
export async function getPoolAccounts(rpcUrl, programId) {
    // In production, fetch from a known PDA or config
    // For now, return the testnet accounts
    return {
        poolAccount: 'DEMitabV4NqSZQUqiK8PQNiPJ3DYbHYJotgA9MgMQkpS',
        merkleAccount: 'DEt4dARcaRZasHWusbMtUPtqYdTaUL72rza5T9z1dw68',
        nullifierAccount: '8tqoDduwnZvCHLm5UEHZk9f74FrTdCbr8hnvp1dTU7Bm',
    };
}

/**
 * Fetch pool state from on-chain
 */
export async function fetchPoolState(rpcUrl, poolAccount, headers = { 'Content-Type': 'application/json' }) {
    const response = await fetch(rpcUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'getAccountInfo',
            params: [poolAccount, { encoding: 'base64' }],
        }),
    });

    const result = await response.json();

    if (!result.result || !result.result.value) {
        return null;
    }

    const data = Buffer.from(result.result.value.data[0], 'base64');

    // Parse PoolState structure (must match pool.zig)
    // Layout:
    // - is_initialized: u8
    // - bump: u8
    // - reserve_a: u64
    // - reserve_b: u64
    // - total_lp_supply: u64
    // - token_a_mint: [32]u8
    // - token_b_mint: [32]u8
    // - pool_state_hash: [32]u8
    // - lp_state_hash: [32]u8

    return {
        isInitialized: data[0] === 1,
        bump: data[1],
        reserveA: data.readBigUInt64LE(2).toString(),
        reserveB: data.readBigUInt64LE(10).toString(),
        totalLpSupply: data.readBigUInt64LE(18).toString(),
        tokenAMint: data.slice(26, 58).toString('hex'),
        tokenBMint: data.slice(58, 90).toString('hex'),
        poolStateHash: data.slice(90, 122).toString('hex'),
        lpStateHash: data.slice(122, 154).toString('hex'),
    };
}
