/**
 * ZK Proof Generator for Privacy AMM
 * Generates Groth16 proofs for private swaps
 */

const snarkjs = require('snarkjs');
const fs = require('fs');
const path = require('path');
const { buildPoseidon } = require('circomlibjs');

// Paths to circuit artifacts
const WASM_PATH = path.join(__dirname, '../circuits/build/private_swap_js/private_swap.wasm');
const ZKEY_PATH = path.join(__dirname, '../circuits/build/private_swap.zkey');

let poseidon = null;

/**
 * Initialize Poseidon hash function
 */
async function initPoseidon() {
    if (!poseidon) {
        poseidon = await buildPoseidon();
    }
    return poseidon;
}

/**
 * Compute Poseidon hash of multiple inputs
 */
async function poseidonHash(inputs) {
    const p = await initPoseidon();
    const hash = p(inputs.map(x => BigInt(x)));
    return p.F.toString(hash);
}

/**
 * Compute UTXO commitment
 * commitment = Poseidon(amount, assetId, pubkey, blinding)
 */
async function computeCommitment(amount, assetId, pubkey, blinding) {
    return poseidonHash([amount, assetId, pubkey, blinding]);
}

/**
 * Compute nullifier for a UTXO
 * nullifier = Poseidon(commitment, privateKey, leafIndex)
 */
async function computeNullifier(commitment, privateKey, leafIndex) {
    return poseidonHash([commitment, privateKey, leafIndex]);
}

/**
 * Compute pool state hash
 * stateHash = Poseidon(reserveA, reserveB, poolPubkey, poolBlinding)
 */
async function computePoolStateHash(reserveA, reserveB, poolPubkey, poolBlinding) {
    return poseidonHash([reserveA, reserveB, poolPubkey, poolBlinding]);
}

/**
 * Derive public key from private key
 * Simple derivation: pubkey = Poseidon(privateKey)
 */
async function derivePublicKey(privateKey) {
    return poseidonHash([privateKey]);
}

/**
 * Generate swap proof
 *
 * @param {Object} params - Swap parameters
 * @param {string} params.root - Merkle root
 * @param {Array} params.inputUtxos - Array of 2 input UTXOs
 * @param {Array} params.outputUtxos - Array of 2 output UTXOs
 * @param {Object} params.poolState - Current pool state
 * @param {Object} params.newPoolState - New pool state after swap
 * @param {Object} params.swapParams - Swap parameters
 * @returns {Object} - Proof and public signals
 */
async function generateSwapProof(params) {
    const {
        root,
        inputUtxos,      // [{ amount, assetId, privateKey, blinding, pathElements, pathIndices }]
        outputUtxos,     // [{ amount, assetId, pubkey, blinding }]
        poolState,       // { reserveA, reserveB, poolPubkey, poolBlinding }
        newPoolState,    // { reserveA, reserveB, poolBlinding }
        swapParams,      // { amountIn, assetIn, amountOut, minAmountOut }
        extDataHash,     // External data hash (for preventing transaction malleability)
    } = params;

    // Compute commitments and nullifiers for inputs
    const inputCommitments = [];
    const inputNullifiers = [];
    const inputPubkeys = [];

    for (let i = 0; i < 2; i++) {
        const utxo = inputUtxos[i];
        const pubkey = await derivePublicKey(utxo.privateKey);
        inputPubkeys.push(pubkey);

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
            utxo.pathIndices[0]  // Use first path index as leaf index
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
        poolState.poolPubkey,  // Pool pubkey doesn't change
        newPoolState.poolBlinding
    );

    // Prepare circuit input
    const circuitInput = {
        // Public inputs
        root: root,
        inputNullifier: inputNullifiers,
        outputCommitment: outputCommitments,
        poolStateHash: poolStateHash,
        newPoolStateHash: newPoolStateHash,
        extDataHash: extDataHash,

        // Private inputs - Input UTXOs
        inAmount: inputUtxos.map(u => u.amount),
        inAssetId: inputUtxos.map(u => u.assetId),
        inPrivateKey: inputUtxos.map(u => u.privateKey),
        inBlinding: inputUtxos.map(u => u.blinding),
        inPathElements: inputUtxos.map(u => u.pathElements),
        inPathIndices: inputUtxos.map(u => u.pathIndices),

        // Private inputs - Output UTXOs
        outAmount: outputUtxos.map(u => u.amount),
        outAssetId: outputUtxos.map(u => u.assetId),
        outPubkey: outputUtxos.map(u => u.pubkey),
        outBlinding: outputUtxos.map(u => u.blinding),

        // Private inputs - Pool state
        reserveA: poolState.reserveA,
        reserveB: poolState.reserveB,
        poolPubkey: poolState.poolPubkey,
        poolBlinding: poolState.poolBlinding,

        // Private inputs - New pool state
        newReserveA: newPoolState.reserveA,
        newReserveB: newPoolState.reserveB,
        newPoolBlinding: newPoolState.poolBlinding,

        // Private inputs - Swap params
        swapAmountIn: swapParams.amountIn,
        swapAssetIn: swapParams.assetIn,
        swapAmountOut: swapParams.amountOut,
        minAmountOut: swapParams.minAmountOut,
    };

    // Generate proof
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        circuitInput,
        WASM_PATH,
        ZKEY_PATH
    );

    return {
        proof,
        publicSignals,
        // Return computed values for convenience
        inputNullifiers,
        outputCommitments,
        poolStateHash,
        newPoolStateHash,
    };
}

/**
 * Format proof for Solana program
 * Converts snarkjs proof format to bytes
 */
function formatProofForSolana(proof) {
    // Convert G1 point (2 BigInts) to 64 bytes (little-endian)
    function g1ToBytes(point) {
        const bytes = Buffer.alloc(64);
        const x = BigInt(point[0]);
        const y = BigInt(point[1]);

        for (let i = 0; i < 32; i++) {
            bytes[i] = Number((x >> BigInt(i * 8)) & 0xFFn);
            bytes[32 + i] = Number((y >> BigInt(i * 8)) & 0xFFn);
        }
        return bytes;
    }

    // Convert G2 point (2x2 BigInts) to 128 bytes (little-endian)
    function g2ToBytes(point) {
        const bytes = Buffer.alloc(128);
        // point[0] = [x_im, x_re], point[1] = [y_im, y_re]
        const coords = [
            BigInt(point[0][0]), // x_im
            BigInt(point[0][1]), // x_re
            BigInt(point[1][0]), // y_im
            BigInt(point[1][1]), // y_re
        ];

        for (let c = 0; c < 4; c++) {
            for (let i = 0; i < 32; i++) {
                bytes[c * 32 + i] = Number((coords[c] >> BigInt(i * 8)) & 0xFFn);
            }
        }
        return bytes;
    }

    // pi_a (G1), pi_b (G2), pi_c (G1)
    const pi_a = g1ToBytes(proof.pi_a);
    const pi_b = g2ToBytes(proof.pi_b);
    const pi_c = g1ToBytes(proof.pi_c);

    // Concatenate: 64 + 128 + 64 = 256 bytes
    return Buffer.concat([pi_a, pi_b, pi_c]);
}

/**
 * Format public signals for Solana program
 */
function formatPublicSignalsForSolana(publicSignals) {
    // Each signal is a field element (32 bytes, little-endian)
    const bytes = Buffer.alloc(publicSignals.length * 32);

    for (let i = 0; i < publicSignals.length; i++) {
        const val = BigInt(publicSignals[i]);
        for (let j = 0; j < 32; j++) {
            bytes[i * 32 + j] = Number((val >> BigInt(j * 8)) & 0xFFn);
        }
    }

    return bytes;
}

/**
 * Verify proof locally (for testing)
 */
async function verifyProofLocal(proof, publicSignals) {
    const vkPath = path.join(__dirname, '../circuits/build/verification_key.json');
    const vk = JSON.parse(fs.readFileSync(vkPath, 'utf8'));
    return snarkjs.groth16.verify(vk, publicSignals, proof);
}

module.exports = {
    initPoseidon,
    poseidonHash,
    computeCommitment,
    computeNullifier,
    computePoolStateHash,
    derivePublicKey,
    generateSwapProof,
    formatProofForSolana,
    formatPublicSignalsForSolana,
    verifyProofLocal,
};
