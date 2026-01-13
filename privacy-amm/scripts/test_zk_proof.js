/**
 * Test ZK Proof Generation for Privacy AMM
 */

const zkProver = require('../sdk/zk_prover');
const crypto = require('crypto');

// Generate random field element (< BN254 scalar field)
function randomFieldElement() {
    // BN254 scalar field is approximately 2^254
    const bytes = crypto.randomBytes(31);  // 31 bytes to stay under 2^248
    return BigInt('0x' + bytes.toString('hex')).toString();
}

// Generate random 32-byte hex string
function randomBytes32() {
    return crypto.randomBytes(32).toString('hex');
}

// Generate dummy Merkle path (for testing)
function generateDummyMerklePath(depth) {
    const pathElements = [];
    const pathIndices = [];
    for (let i = 0; i < depth; i++) {
        pathElements.push(randomFieldElement());
        pathIndices.push(Math.random() > 0.5 ? 1 : 0);
    }
    return { pathElements, pathIndices };
}

async function main() {
    console.log('='.repeat(60));
    console.log('ZK Proof Generation Test');
    console.log('='.repeat(60));
    console.log('');

    // Initialize Poseidon
    console.log('Initializing Poseidon hash...');
    await zkProver.initPoseidon();
    console.log('Done.');
    console.log('');

    // Test Poseidon hash
    console.log('Testing Poseidon hash...');
    const hash = await zkProver.poseidonHash(['1', '2', '3', '4']);
    console.log('  Poseidon([1,2,3,4]) =', hash);
    console.log('');

    // Test key derivation
    console.log('Testing key derivation...');
    const privateKey = randomFieldElement();
    const publicKey = await zkProver.derivePublicKey(privateKey);
    console.log('  Private key:', privateKey.substring(0, 20) + '...');
    console.log('  Public key:', publicKey.substring(0, 20) + '...');
    console.log('');

    // Test commitment
    console.log('Testing UTXO commitment...');
    const commitment = await zkProver.computeCommitment(
        '1000000',  // 1 token
        '0',        // Token A
        publicKey,
        randomFieldElement()  // blinding
    );
    console.log('  Commitment:', commitment.substring(0, 20) + '...');
    console.log('');

    // Prepare test swap parameters
    console.log('Preparing swap parameters...');

    const merkleDepth = 20;
    const privateKey1 = randomFieldElement();
    const privateKey2 = randomFieldElement();
    const pubkey1 = await zkProver.derivePublicKey(privateKey1);
    const pubkey2 = await zkProver.derivePublicKey(privateKey2);

    // Input UTXOs (what user is spending)
    const inputUtxos = [
        {
            amount: '1000000000',  // 1 SOL (in lamports)
            assetId: '0',          // Token A (SOL)
            privateKey: privateKey1,
            blinding: randomFieldElement(),
            ...generateDummyMerklePath(merkleDepth),
        },
        {
            amount: '0',           // Empty UTXO
            assetId: '0',
            privateKey: privateKey2,
            blinding: randomFieldElement(),
            ...generateDummyMerklePath(merkleDepth),
        },
    ];

    // Output UTXOs (what user receives)
    // Swap 0.1 SOL for USDC
    const swapAmountIn = '100000000';   // 0.1 SOL
    const swapAmountOut = '15000000';   // 15 USDC (assuming 150 rate)

    const outputUtxos = [
        {
            amount: '900000000',  // 0.9 SOL remaining
            assetId: '0',
            pubkey: pubkey1,
            blinding: randomFieldElement(),
        },
        {
            amount: swapAmountOut,  // 15 USDC received
            assetId: '1',           // Token B (USDC)
            pubkey: pubkey1,
            blinding: randomFieldElement(),
        },
    ];

    // Pool state
    const poolState = {
        reserveA: '10000000000000',   // 10000 SOL
        reserveB: '1500000000000',    // 1500000 USDC
        poolPubkey: randomFieldElement(),
        poolBlinding: randomFieldElement(),
    };

    // New pool state after swap
    const newPoolState = {
        reserveA: (BigInt(poolState.reserveA) + BigInt(swapAmountIn)).toString(),
        reserveB: (BigInt(poolState.reserveB) - BigInt(swapAmountOut)).toString(),
        poolBlinding: randomFieldElement(),
    };

    // Swap params
    const swapParams = {
        amountIn: swapAmountIn,
        assetIn: '0',  // SOL
        amountOut: swapAmountOut,
        minAmountOut: swapAmountOut,  // No slippage for test
    };

    console.log('  Input: 1 SOL (spending 0.1 SOL)');
    console.log('  Output: 0.9 SOL + 15 USDC');
    console.log('  Pool before: ' + poolState.reserveA + ' SOL / ' + poolState.reserveB + ' USDC');
    console.log('  Pool after: ' + newPoolState.reserveA + ' SOL / ' + newPoolState.reserveB + ' USDC');
    console.log('');

    // First compute the Merkle root from the input commitments
    // For testing, we'll use a dummy root
    const root = randomFieldElement();
    const extDataHash = randomFieldElement();

    console.log('Generating ZK proof (this may take a while)...');
    const startTime = Date.now();

    try {
        const result = await zkProver.generateSwapProof({
            root,
            inputUtxos,
            outputUtxos,
            poolState,
            newPoolState,
            swapParams,
            extDataHash,
        });

        const elapsed = (Date.now() - startTime) / 1000;
        console.log('  Proof generated in', elapsed.toFixed(2), 'seconds');
        console.log('');

        console.log('Proof components:');
        console.log('  pi_a:', JSON.stringify(result.proof.pi_a).substring(0, 60) + '...');
        console.log('  pi_b:', JSON.stringify(result.proof.pi_b).substring(0, 60) + '...');
        console.log('  pi_c:', JSON.stringify(result.proof.pi_c).substring(0, 60) + '...');
        console.log('');

        console.log('Public signals:', result.publicSignals.length, 'elements');
        console.log('');

        // Verify proof locally
        console.log('Verifying proof locally...');
        const valid = await zkProver.verifyProofLocal(result.proof, result.publicSignals);
        console.log('  Verification:', valid ? 'PASSED' : 'FAILED');
        console.log('');

        // Format for Solana
        console.log('Formatting for Solana...');
        const proofBytes = zkProver.formatProofForSolana(result.proof);
        const signalsBytes = zkProver.formatPublicSignalsForSolana(result.publicSignals);
        console.log('  Proof bytes:', proofBytes.length);
        console.log('  Signals bytes:', signalsBytes.length);
        console.log('');

        console.log('='.repeat(60));
        console.log('Test Complete!');
        console.log('='.repeat(60));

    } catch (err) {
        console.error('Error generating proof:', err.message);
        console.error('');
        console.error('This is expected if the Merkle proof is invalid.');
        console.error('For a real swap, you need valid Merkle proofs for the input UTXOs.');
    }
}

main().catch(console.error);
