/**
 * Privacy AMM - Private Swap Circuit Test
 * 测试隐私交换电路
 */

const snarkjs = require("snarkjs");
const { buildPoseidon } = require("circomlibjs");
const fs = require("fs");
const path = require("path");

// Constants
const MERKLE_DEPTH = 20;
const ZERO_VALUE = BigInt("21663839004416932945382355908790599225266501822907911457504978515578255421292");

// Helper: Convert BigInt to string for JSON
function bigIntReplacer(key, value) {
    if (typeof value === 'bigint') {
        return value.toString();
    }
    return value;
}

// Build empty Merkle tree and return zeros array
function buildZeros(poseidon, depth) {
    const F = poseidon.F;
    const zeros = [ZERO_VALUE];
    for (let i = 1; i <= depth; i++) {
        zeros.push(F.toObject(poseidon([zeros[i-1], zeros[i-1]])));
    }
    return zeros;
}

// Compute Merkle proof for a leaf at given index
function computeMerkleProof(poseidon, leaves, index, depth) {
    const F = poseidon.F;
    const zeros = buildZeros(poseidon, depth);

    // Build tree level by level
    let currentLevel = [];
    for (let i = 0; i < (1 << depth); i++) {
        currentLevel.push(i < leaves.length ? leaves[i] : zeros[0]);
    }

    const pathElements = [];
    const pathIndices = [];

    let currentIndex = index;
    for (let level = 0; level < depth; level++) {
        const siblingIndex = currentIndex ^ 1;
        pathElements.push(currentLevel[siblingIndex]);
        pathIndices.push(currentIndex % 2);

        // Compute next level
        const nextLevel = [];
        for (let i = 0; i < currentLevel.length; i += 2) {
            nextLevel.push(F.toObject(poseidon([currentLevel[i], currentLevel[i + 1]])));
        }
        currentLevel = nextLevel;
        currentIndex = Math.floor(currentIndex / 2);
    }

    return {
        root: currentLevel[0],
        pathElements,
        pathIndices
    };
}

// Compute UTXO commitment
function computeCommitment(poseidon, amount, assetId, pubkey, blinding) {
    const F = poseidon.F;
    return F.toObject(poseidon([amount, assetId, pubkey, blinding]));
}

// Compute nullifier
function computeNullifier(poseidon, commitment, privateKey, leafIndex) {
    const F = poseidon.F;
    return F.toObject(poseidon([commitment, privateKey, leafIndex]));
}

// Derive public key from private key
function derivePublicKey(poseidon, privateKey) {
    const F = poseidon.F;
    return F.toObject(poseidon([privateKey]));
}

// Compute pool state hash
function computePoolStateHash(poseidon, reserveA, reserveB, poolPubkey, poolBlinding) {
    const F = poseidon.F;
    return F.toObject(poseidon([reserveA, reserveB, poolPubkey, poolBlinding]));
}

async function main() {
    console.log("=".repeat(60));
    console.log("Privacy AMM - Private Swap Circuit Test");
    console.log("=".repeat(60));

    // Initialize Poseidon
    console.log("\n[1/6] Initializing Poseidon hasher...");
    const poseidon = await buildPoseidon();
    const F = poseidon.F;

    // Test parameters
    const privateKey1 = BigInt("12345678901234567890");
    const privateKey2 = BigInt("98765432109876543210");
    const poolPrivateKey = BigInt("55555555555555555555");

    const pubkey1 = derivePublicKey(poseidon, privateKey1);
    const pubkey2 = derivePublicKey(poseidon, privateKey2);
    const poolPubkey = derivePublicKey(poseidon, poolPrivateKey);

    console.log("  Private Key 1:", privateKey1.toString());
    console.log("  Public Key 1:", pubkey1.toString());

    // Pool state (before swap)
    // User swaps 100 TokenA for ~99 TokenB (1% fee included in k increase)
    const reserveA = BigInt(10000);   // 10,000 TokenA
    const reserveB = BigInt(10000);   // 10,000 TokenB
    const poolBlinding = BigInt(111111);

    // Swap: 100 TokenA in, expect ~99 TokenB out (xy=k formula)
    // newReserveA = 10100, newReserveB = 9901 (rounded)
    // k_before = 100,000,000
    // k_after  = 100,009,901 >= k_before ✓
    const swapAmountIn = BigInt(100);
    const swapAssetIn = BigInt(0);  // TokenA as input
    const swapAmountOut = BigInt(99);  // Output TokenB
    const minAmountOut = BigInt(95);  // 5% slippage tolerance

    const newReserveA = reserveA + swapAmountIn;
    const newReserveB = reserveB - swapAmountOut;
    const newPoolBlinding = BigInt(222222);

    console.log("\n[2/6] Setting up test scenario...");
    console.log("  Pool reserves (before): A =", reserveA.toString(), ", B =", reserveB.toString());
    console.log("  Pool reserves (after):  A =", newReserveA.toString(), ", B =", newReserveB.toString());
    console.log("  k_before =", (reserveA * reserveB).toString());
    console.log("  k_after  =", (newReserveA * newReserveB).toString());
    console.log("  Swap:", swapAmountIn.toString(), "TokenA ->", swapAmountOut.toString(), "TokenB");

    // Input UTXOs
    // User has two UTXOs: 150 TokenA, 50 TokenB
    const inAmount = [BigInt(150), BigInt(50)];
    const inAssetId = [BigInt(0), BigInt(1)];  // TokenA, TokenB
    const inBlinding = [BigInt(1001), BigInt(1002)];

    // Output UTXOs (after swap)
    // User will have: (150 - 100) = 50 TokenA, (50 + 99) = 149 TokenB
    const outAmount = [BigInt(50), BigInt(149)];
    const outAssetId = [BigInt(0), BigInt(1)];  // TokenA, TokenB
    const outBlinding = [BigInt(2001), BigInt(2002)];
    const outPubkey = [pubkey1, pubkey1];  // Same owner

    // Verify fund conservation
    const totalIn = inAmount[0] + inAmount[1];  // 150 + 50 = 200
    const totalOut = outAmount[0] + outAmount[1];  // 50 + 149 = 199
    const netBalance = totalIn - swapAmountIn + swapAmountOut;  // 200 - 100 + 99 = 199
    console.log("\n  Fund conservation check:");
    console.log("    Total input:", totalIn.toString());
    console.log("    Total output:", totalOut.toString());
    console.log("    Net balance (in - swapIn + swapOut):", netBalance.toString());
    console.log("    Conservation valid:", netBalance === totalOut ? "YES" : "NO");

    // Compute commitments
    console.log("\n[3/6] Computing commitments and nullifiers...");
    const inCommitment = [
        computeCommitment(poseidon, inAmount[0], inAssetId[0], pubkey1, inBlinding[0]),
        computeCommitment(poseidon, inAmount[1], inAssetId[1], pubkey1, inBlinding[1])
    ];

    const outCommitment = [
        computeCommitment(poseidon, outAmount[0], outAssetId[0], outPubkey[0], outBlinding[0]),
        computeCommitment(poseidon, outAmount[1], outAssetId[1], outPubkey[1], outBlinding[1])
    ];

    console.log("  Input Commitment 0:", inCommitment[0].toString().slice(0, 20) + "...");
    console.log("  Input Commitment 1:", inCommitment[1].toString().slice(0, 20) + "...");
    console.log("  Output Commitment 0:", outCommitment[0].toString().slice(0, 20) + "...");
    console.log("  Output Commitment 1:", outCommitment[1].toString().slice(0, 20) + "...");

    // Build Merkle tree with input commitments
    console.log("\n[4/6] Building Merkle tree...");
    const leaves = [inCommitment[0], inCommitment[1]];
    const proof0 = computeMerkleProof(poseidon, leaves, 0, MERKLE_DEPTH);
    const proof1 = computeMerkleProof(poseidon, leaves, 1, MERKLE_DEPTH);

    console.log("  Merkle root:", proof0.root.toString().slice(0, 20) + "...");
    console.log("  Path indices 0:", proof0.pathIndices.slice(0, 5).join(", ") + "...");
    console.log("  Path indices 1:", proof1.pathIndices.slice(0, 5).join(", ") + "...");

    // Compute nullifiers
    const inputNullifier = [
        computeNullifier(poseidon, inCommitment[0], privateKey1, BigInt(proof0.pathIndices[0])),
        computeNullifier(poseidon, inCommitment[1], privateKey1, BigInt(proof1.pathIndices[0]))
    ];

    console.log("  Nullifier 0:", inputNullifier[0].toString().slice(0, 20) + "...");
    console.log("  Nullifier 1:", inputNullifier[1].toString().slice(0, 20) + "...");

    // Compute pool state hashes
    const poolStateHash = computePoolStateHash(poseidon, reserveA, reserveB, poolPubkey, poolBlinding);
    const newPoolStateHash = computePoolStateHash(poseidon, newReserveA, newReserveB, poolPubkey, newPoolBlinding);

    console.log("  Pool State Hash (before):", poolStateHash.toString().slice(0, 20) + "...");
    console.log("  Pool State Hash (after):", newPoolStateHash.toString().slice(0, 20) + "...");

    // External data hash (placeholder)
    const extDataHash = F.toObject(poseidon([BigInt(1), BigInt(2), BigInt(3)]));

    // Build circuit input
    console.log("\n[5/6] Preparing circuit input...");
    const circuitInput = {
        // Public inputs
        root: proof0.root.toString(),
        inputNullifier: inputNullifier.map(n => n.toString()),
        outputCommitment: outCommitment.map(c => c.toString()),
        poolStateHash: poolStateHash.toString(),
        newPoolStateHash: newPoolStateHash.toString(),
        extDataHash: extDataHash.toString(),

        // Private inputs - Input UTXOs
        inAmount: inAmount.map(a => a.toString()),
        inAssetId: inAssetId.map(a => a.toString()),
        inPrivateKey: [privateKey1.toString(), privateKey1.toString()],
        inBlinding: inBlinding.map(b => b.toString()),
        inPathElements: [
            proof0.pathElements.map(e => e.toString()),
            proof1.pathElements.map(e => e.toString())
        ],
        inPathIndices: [
            proof0.pathIndices.map(i => i.toString()),
            proof1.pathIndices.map(i => i.toString())
        ],

        // Private inputs - Output UTXOs
        outAmount: outAmount.map(a => a.toString()),
        outAssetId: outAssetId.map(a => a.toString()),
        outPubkey: outPubkey.map(p => p.toString()),
        outBlinding: outBlinding.map(b => b.toString()),

        // Private inputs - Pool state (before)
        reserveA: reserveA.toString(),
        reserveB: reserveB.toString(),
        poolPubkey: poolPubkey.toString(),
        poolBlinding: poolBlinding.toString(),

        // Private inputs - Pool state (after)
        newReserveA: newReserveA.toString(),
        newReserveB: newReserveB.toString(),
        newPoolBlinding: newPoolBlinding.toString(),

        // Private inputs - Swap parameters
        swapAmountIn: swapAmountIn.toString(),
        swapAssetIn: swapAssetIn.toString(),
        swapAmountOut: swapAmountOut.toString(),
        minAmountOut: minAmountOut.toString()
    };

    // Save input to file
    const inputPath = path.join(__dirname, "../build/test_input.json");
    fs.writeFileSync(inputPath, JSON.stringify(circuitInput, null, 2));
    console.log("  Input saved to:", inputPath);

    // Generate witness and proof
    console.log("\n[6/6] Generating witness and proof...");
    const wasmPath = path.join(__dirname, "../build/private_swap_js/private_swap.wasm");
    const zkeyPath = path.join(__dirname, "../build/private_swap.zkey");
    const vkeyPath = path.join(__dirname, "../build/verification_key.json");

    try {
        // Generate witness
        console.log("  Calculating witness...");
        const startWitness = Date.now();
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(
            circuitInput,
            wasmPath,
            zkeyPath
        );
        const witnessTime = Date.now() - startWitness;
        console.log("  Witness + proof generated in", witnessTime, "ms");

        // Verify proof
        console.log("  Verifying proof...");
        const vKey = JSON.parse(fs.readFileSync(vkeyPath, "utf8"));
        const startVerify = Date.now();
        const verified = await snarkjs.groth16.verify(vKey, publicSignals, proof);
        const verifyTime = Date.now() - startVerify;

        console.log("\n" + "=".repeat(60));
        if (verified) {
            console.log("  PROOF VERIFIED SUCCESSFULLY!");
            console.log("=".repeat(60));
            console.log("\n  Public Signals:");
            console.log("    Root:", publicSignals[0].slice(0, 20) + "...");
            console.log("    Nullifier 0:", publicSignals[1].slice(0, 20) + "...");
            console.log("    Nullifier 1:", publicSignals[2].slice(0, 20) + "...");
            console.log("    Output Commitment 0:", publicSignals[3].slice(0, 20) + "...");
            console.log("    Output Commitment 1:", publicSignals[4].slice(0, 20) + "...");
            console.log("    Pool State Hash:", publicSignals[5].slice(0, 20) + "...");
            console.log("    New Pool State Hash:", publicSignals[6].slice(0, 20) + "...");
            console.log("    Ext Data Hash:", publicSignals[7].slice(0, 20) + "...");
            console.log("\n  Performance:");
            console.log("    Proof generation:", witnessTime, "ms");
            console.log("    Verification:", verifyTime, "ms");

            // Save proof
            const proofPath = path.join(__dirname, "../build/test_proof.json");
            fs.writeFileSync(proofPath, JSON.stringify({ proof, publicSignals }, null, 2));
            console.log("\n  Proof saved to:", proofPath);
        } else {
            console.log("  PROOF VERIFICATION FAILED!");
            console.log("=".repeat(60));
            process.exit(1);
        }
    } catch (error) {
        console.error("\n  ERROR:", error.message);
        console.log("=".repeat(60));
        process.exit(1);
    }
}

main().catch(console.error);
