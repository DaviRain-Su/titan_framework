/**
 * ZK Prover for Browser
 * Generates Groth16 proofs using snarkjs in the browser
 */

import * as snarkjs from 'snarkjs';

// Circuit paths (relative to public folder)
const CIRCUITS = {
    swap: {
        wasm: '/circuits/private_swap.wasm',
        zkey: '/circuits/private_swap.zkey',
    },
    addLiquidity: {
        wasm: '/circuits/private_add_liquidity.wasm',
        zkey: '/circuits/private_add_liquidity.zkey',
    },
    removeLiquidity: {
        wasm: '/circuits/private_remove_liquidity.wasm',
        zkey: '/circuits/private_remove_liquidity.zkey',
    },
};

// Poseidon hash instance
let poseidon = null;
let poseidonPromise = null;

/**
 * Initialize Poseidon hash function
 */
export async function initPoseidon() {
    if (poseidon) return poseidon;

    if (!poseidonPromise) {
        poseidonPromise = (async () => {
            const { buildPoseidon } = await import('circomlibjs');
            poseidon = await buildPoseidon();
            return poseidon;
        })();
    }

    return poseidonPromise;
}

/**
 * Compute Poseidon hash of multiple inputs
 */
export async function poseidonHash(inputs) {
    const p = await initPoseidon();
    const hash = p(inputs.map(x => BigInt(x)));
    return p.F.toString(hash);
}

/**
 * Compute UTXO commitment
 * commitment = Poseidon(amount, assetId, pubkey, blinding)
 */
export async function computeCommitment(amount, assetId, pubkey, blinding) {
    return poseidonHash([amount, assetId, pubkey, blinding]);
}

/**
 * Compute nullifier for a UTXO
 * nullifier = Poseidon(commitment, privateKey, leafIndex)
 */
export async function computeNullifier(commitment, privateKey, leafIndex) {
    return poseidonHash([commitment, privateKey, leafIndex]);
}

/**
 * Compute pool state hash
 */
export async function computePoolStateHash(reserveA, reserveB, poolPubkey, poolBlinding) {
    // Convert poolPubkey to field element if it's a base58 string
    const poolPubkeyField = pubkeyToFieldElement(poolPubkey);
    return poseidonHash([reserveA, reserveB, poolPubkeyField, poolBlinding]);
}

/**
 * Compute LP state hash
 */
export async function computeLpStateHash(totalLpSupply, lpPoolPubkey, lpBlinding) {
    // Convert lpPoolPubkey to field element if it's a base58 string
    const lpPoolPubkeyField = pubkeyToFieldElement(lpPoolPubkey);
    return poseidonHash([totalLpSupply, lpPoolPubkeyField, lpBlinding]);
}

/**
 * Derive public key from private key
 */
export async function derivePublicKey(privateKey) {
    return poseidonHash([privateKey]);
}

/**
 * Generate random field element (for blinding factors, private keys)
 */
export function randomFieldElement() {
    const bytes = new Uint8Array(31);
    crypto.getRandomValues(bytes);
    let value = BigInt(0);
    for (let i = 0; i < 31; i++) {
        value = value * 256n + BigInt(bytes[i]);
    }
    return value.toString();
}

/**
 * Convert base58 public key to field element
 * Used for ZK circuit inputs that need numeric representation of addresses
 */
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BN254_FIELD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

export function pubkeyToFieldElement(pubkeyBase58) {
    // If already a number string, return as-is
    if (/^\d+$/.test(pubkeyBase58)) {
        return pubkeyBase58;
    }

    // Decode base58 to BigInt
    let num = BigInt(0);
    for (const char of pubkeyBase58) {
        const idx = BASE58_ALPHABET.indexOf(char);
        if (idx === -1) throw new Error(`Invalid base58 character: ${char}`);
        num = num * 58n + BigInt(idx);
    }

    // Reduce modulo BN254 field prime to fit in a field element
    num = num % BN254_FIELD_PRIME;

    return num.toString();
}

/**
 * Load circuit files
 */
async function loadCircuit(circuitType) {
    const circuit = CIRCUITS[circuitType];
    if (!circuit) {
        throw new Error(`Unknown circuit type: ${circuitType}`);
    }

    // Fetch WASM
    const wasmResponse = await fetch(circuit.wasm);
    const wasmBuffer = await wasmResponse.arrayBuffer();

    // Fetch zkey
    const zkeyResponse = await fetch(circuit.zkey);
    const zkeyBuffer = await zkeyResponse.arrayBuffer();

    return {
        wasm: new Uint8Array(wasmBuffer),
        zkey: new Uint8Array(zkeyBuffer),
    };
}

/**
 * Generate swap proof
 */
export async function generateSwapProof(params) {
    const {
        root,
        inputUtxos,
        outputUtxos,
        poolState,
        newPoolState,
        swapParams,
        extDataHash,
    } = params;

    // Initialize Poseidon
    await initPoseidon();

    // Compute commitments and nullifiers for inputs
    const inputCommitments = [];
    const inputNullifiers = [];

    for (let i = 0; i < 2; i++) {
        const utxo = inputUtxos[i];
        const pubkey = await derivePublicKey(utxo.privateKey);

        const commitment = await computeCommitment(
            utxo.amount,
            utxo.assetId,
            pubkey,
            utxo.blinding
        );
        inputCommitments.push(commitment);

        const nullifier = await computeNullifier(
            commitment,
            utxo.privateKey,
            utxo.pathIndices[0]
        );
        inputNullifiers.push(nullifier);
    }

    // Compute commitments for outputs
    const outputCommitments = [];
    for (let i = 0; i < 2; i++) {
        const utxo = outputUtxos[i];
        const commitment = await computeCommitment(
            utxo.amount,
            utxo.assetId,
            utxo.pubkey,
            utxo.blinding
        );
        outputCommitments.push(commitment);
    }

    // Compute pool state hashes
    const poolStateHash = await computePoolStateHash(
        poolState.reserveA,
        poolState.reserveB,
        poolState.poolPubkey,
        poolState.poolBlinding
    );

    const newPoolStateHash = await computePoolStateHash(
        newPoolState.reserveA,
        newPoolState.reserveB,
        poolState.poolPubkey,
        newPoolState.poolBlinding
    );

    // Prepare circuit input (convert pubkeys to field elements)
    const poolPubkeyField = pubkeyToFieldElement(poolState.poolPubkey);

    const circuitInput = {
        root,
        inputNullifier: inputNullifiers,
        outputCommitment: outputCommitments,
        poolStateHash,
        newPoolStateHash,
        extDataHash,
        inAmount: inputUtxos.map(u => u.amount),
        inAssetId: inputUtxos.map(u => u.assetId),
        inPrivateKey: inputUtxos.map(u => u.privateKey),
        inBlinding: inputUtxos.map(u => u.blinding),
        inPathElements: inputUtxos.map(u => u.pathElements),
        inPathIndices: inputUtxos.map(u => u.pathIndices),
        outAmount: outputUtxos.map(u => u.amount),
        outAssetId: outputUtxos.map(u => u.assetId),
        outPubkey: outputUtxos.map(u => u.pubkey),
        outBlinding: outputUtxos.map(u => u.blinding),
        reserveA: poolState.reserveA,
        reserveB: poolState.reserveB,
        poolPubkey: poolPubkeyField,
        poolBlinding: poolState.poolBlinding,
        newReserveA: newPoolState.reserveA,
        newReserveB: newPoolState.reserveB,
        newPoolBlinding: newPoolState.poolBlinding,
        swapAmountIn: swapParams.amountIn,
        swapAssetIn: swapParams.assetIn,
        swapAmountOut: swapParams.amountOut,
        minAmountOut: swapParams.minAmountOut,
    };

    // Load circuit and generate proof
    const { wasm, zkey } = await loadCircuit('swap');
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        circuitInput,
        wasm,
        zkey
    );

    return {
        proof,
        publicSignals,
        inputNullifiers,
        outputCommitments,
        poolStateHash,
        newPoolStateHash,
    };
}

/**
 * Generate add liquidity proof
 */
export async function generateAddLiquidityProof(params) {
    const {
        root,
        inputUtxos,
        outputUtxo,
        poolState,
        newPoolState,
        lpState,
        newLpState,
        extDataHash,
    } = params;

    await initPoseidon();

    // Compute nullifiers for inputs
    const inputNullifiers = [];
    for (let i = 0; i < 2; i++) {
        const utxo = inputUtxos[i];
        const pubkey = await derivePublicKey(utxo.privateKey);
        const assetId = i; // 0 = Token A, 1 = Token B

        const commitment = await computeCommitment(
            utxo.amount,
            assetId,
            pubkey,
            utxo.blinding
        );

        const nullifier = await computeNullifier(
            commitment,
            utxo.privateKey,
            utxo.pathIndices[0]
        );
        inputNullifiers.push(nullifier);
    }

    // Compute output LP token commitment
    const outputCommitment = await computeCommitment(
        outputUtxo.lpAmount,
        '2', // LP Token assetId
        outputUtxo.pubkey,
        outputUtxo.blinding
    );

    // Compute state hashes
    const poolStateHash = await computePoolStateHash(
        poolState.reserveA,
        poolState.reserveB,
        poolState.poolPubkey,
        poolState.poolBlinding
    );

    const newPoolStateHash = await computePoolStateHash(
        newPoolState.reserveA,
        newPoolState.reserveB,
        poolState.poolPubkey,
        newPoolState.poolBlinding
    );

    const lpStateHash = await computeLpStateHash(
        lpState.totalLpSupply,
        lpState.lpPoolPubkey,
        lpState.lpBlinding
    );

    const newLpStateHash = await computeLpStateHash(
        newLpState.totalLpSupply,
        lpState.lpPoolPubkey,
        newLpState.lpBlinding
    );

    // Prepare circuit input (convert pubkeys to field elements)
    const poolPubkeyField = pubkeyToFieldElement(poolState.poolPubkey);
    const lpPoolPubkeyField = pubkeyToFieldElement(lpState.lpPoolPubkey);

    const circuitInput = {
        root,
        inputNullifier: inputNullifiers,
        outputCommitment,
        poolStateHash,
        newPoolStateHash,
        lpStateHash,
        newLpStateHash,
        extDataHash,
        inAmountA: inputUtxos[0].amount,
        inAmountB: inputUtxos[1].amount,
        inPrivateKey: inputUtxos.map(u => u.privateKey),
        inBlinding: inputUtxos.map(u => u.blinding),
        inPathElements: inputUtxos.map(u => u.pathElements),
        inPathIndices: inputUtxos.map(u => u.pathIndices),
        outLpAmount: outputUtxo.lpAmount,
        outPubkey: outputUtxo.pubkey,
        outBlinding: outputUtxo.blinding,
        reserveA: poolState.reserveA,
        reserveB: poolState.reserveB,
        poolPubkey: poolPubkeyField,
        poolBlinding: poolState.poolBlinding,
        newReserveA: newPoolState.reserveA,
        newReserveB: newPoolState.reserveB,
        newPoolBlinding: newPoolState.poolBlinding,
        totalLpSupply: lpState.totalLpSupply,
        lpPoolPubkey: lpPoolPubkeyField,
        lpBlinding: lpState.lpBlinding,
        newTotalLpSupply: newLpState.totalLpSupply,
        newLpBlinding: newLpState.lpBlinding,
    };

    const { wasm, zkey } = await loadCircuit('addLiquidity');
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        circuitInput,
        wasm,
        zkey
    );

    return {
        proof,
        publicSignals,
        inputNullifiers,
        outputCommitment,
        poolStateHash,
        newPoolStateHash,
        lpStateHash,
        newLpStateHash,
    };
}

/**
 * Generate remove liquidity proof
 */
export async function generateRemoveLiquidityProof(params) {
    const {
        root,
        inputUtxo,
        outputUtxos,
        poolState,
        newPoolState,
        lpState,
        newLpState,
        extDataHash,
    } = params;

    await initPoseidon();

    // Compute input nullifier
    const inputPubkey = await derivePublicKey(inputUtxo.privateKey);
    const inputCommitment = await computeCommitment(
        inputUtxo.lpAmount,
        '2', // LP Token
        inputPubkey,
        inputUtxo.blinding
    );

    const inputNullifier = await computeNullifier(
        inputCommitment,
        inputUtxo.privateKey,
        inputUtxo.pathIndices[0]
    );

    // Compute output commitments
    const outputCommitments = [];
    for (let i = 0; i < 2; i++) {
        const utxo = outputUtxos[i];
        const commitment = await computeCommitment(
            utxo.amount,
            i, // 0 = Token A, 1 = Token B
            utxo.pubkey,
            utxo.blinding
        );
        outputCommitments.push(commitment);
    }

    // Compute state hashes
    const poolStateHash = await computePoolStateHash(
        poolState.reserveA,
        poolState.reserveB,
        poolState.poolPubkey,
        poolState.poolBlinding
    );

    const newPoolStateHash = await computePoolStateHash(
        newPoolState.reserveA,
        newPoolState.reserveB,
        poolState.poolPubkey,
        newPoolState.poolBlinding
    );

    const lpStateHash = await computeLpStateHash(
        lpState.totalLpSupply,
        lpState.lpPoolPubkey,
        lpState.lpBlinding
    );

    const newLpStateHash = await computeLpStateHash(
        newLpState.totalLpSupply,
        lpState.lpPoolPubkey,
        newLpState.lpBlinding
    );

    // Prepare circuit input (convert pubkeys to field elements)
    const poolPubkeyField = pubkeyToFieldElement(poolState.poolPubkey);
    const lpPoolPubkeyField = pubkeyToFieldElement(lpState.lpPoolPubkey);

    const circuitInput = {
        root,
        inputNullifier,
        outputCommitment: outputCommitments,
        poolStateHash,
        newPoolStateHash,
        lpStateHash,
        newLpStateHash,
        extDataHash,
        inLpAmount: inputUtxo.lpAmount,
        inPrivateKey: inputUtxo.privateKey,
        inBlinding: inputUtxo.blinding,
        inPathElements: inputUtxo.pathElements,
        inPathIndices: inputUtxo.pathIndices,
        outAmountA: outputUtxos[0].amount,
        outPubkeyA: outputUtxos[0].pubkey,
        outBlindingA: outputUtxos[0].blinding,
        outAmountB: outputUtxos[1].amount,
        outPubkeyB: outputUtxos[1].pubkey,
        outBlindingB: outputUtxos[1].blinding,
        reserveA: poolState.reserveA,
        reserveB: poolState.reserveB,
        poolPubkey: poolPubkeyField,
        poolBlinding: poolState.poolBlinding,
        newReserveA: newPoolState.reserveA,
        newReserveB: newPoolState.reserveB,
        newPoolBlinding: newPoolState.poolBlinding,
        totalLpSupply: lpState.totalLpSupply,
        lpPoolPubkey: lpPoolPubkeyField,
        lpBlinding: lpState.lpBlinding,
        newTotalLpSupply: newLpState.totalLpSupply,
        newLpBlinding: newLpState.lpBlinding,
    };

    const { wasm, zkey } = await loadCircuit('removeLiquidity');
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        circuitInput,
        wasm,
        zkey
    );

    return {
        proof,
        publicSignals,
        inputNullifier,
        outputCommitments,
        poolStateHash,
        newPoolStateHash,
        lpStateHash,
        newLpStateHash,
    };
}

/**
 * Format proof for Solana program (256 bytes)
 */
export function formatProofForSolana(proof) {
    function bigIntTo32Bytes(value) {
        const bytes = new Uint8Array(32);
        let v = BigInt(value);
        for (let i = 0; i < 32; i++) {
            bytes[i] = Number(v & 0xFFn);
            v >>= 8n;
        }
        return bytes;
    }

    // G1 point to 64 bytes
    function g1ToBytes(point) {
        const bytes = new Uint8Array(64);
        bytes.set(bigIntTo32Bytes(point[0]), 0);
        bytes.set(bigIntTo32Bytes(point[1]), 32);
        return bytes;
    }

    // G2 point to 128 bytes
    function g2ToBytes(point) {
        const bytes = new Uint8Array(128);
        bytes.set(bigIntTo32Bytes(point[0][0]), 0);
        bytes.set(bigIntTo32Bytes(point[0][1]), 32);
        bytes.set(bigIntTo32Bytes(point[1][0]), 64);
        bytes.set(bigIntTo32Bytes(point[1][1]), 96);
        return bytes;
    }

    const result = new Uint8Array(256);
    result.set(g1ToBytes(proof.pi_a), 0);
    result.set(g2ToBytes(proof.pi_b), 64);
    result.set(g1ToBytes(proof.pi_c), 192);
    return result;
}

/**
 * Format public signals for Solana (32 bytes each)
 */
export function formatPublicSignalsForSolana(publicSignals) {
    const bytes = new Uint8Array(publicSignals.length * 32);

    for (let i = 0; i < publicSignals.length; i++) {
        let val = BigInt(publicSignals[i]);
        for (let j = 0; j < 32; j++) {
            bytes[i * 32 + j] = Number(val & 0xFFn);
            val >>= 8n;
        }
    }

    return bytes;
}
