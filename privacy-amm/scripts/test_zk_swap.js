/**
 * Full ZK Swap Test with Valid Merkle Tree
 * Generates a valid proof that can be verified on-chain
 */

const zkProver = require('../sdk/zk_prover');
const { createMerkleTree } = require('../sdk/merkle_tree');
const crypto = require('crypto');

// Generate random field element
function randomFieldElement() {
    const bytes = crypto.randomBytes(31);
    return BigInt('0x' + bytes.toString('hex')).toString();
}

async function main() {
    console.log('='.repeat(60));
    console.log('ZK Private Swap Test (Valid Merkle Tree)');
    console.log('='.repeat(60));
    console.log('');

    // Initialize
    console.log('Initializing Poseidon and Merkle tree...');
    await zkProver.initPoseidon();
    const tree = await createMerkleTree(20);  // Depth 20
    console.log('Done.');
    console.log('');

    // Create user keys
    console.log('Creating user keys...');
    const privateKey1 = randomFieldElement();
    const privateKey2 = randomFieldElement();
    const pubkey1 = await zkProver.derivePublicKey(privateKey1);
    const pubkey2 = await zkProver.derivePublicKey(privateKey2);
    console.log('  User 1 pubkey:', pubkey1.substring(0, 20) + '...');
    console.log('');

    // Create input UTXOs
    console.log('Creating input UTXOs...');

    // UTXO 1: 1 SOL
    const utxo1 = {
        amount: '1000000000',  // 1 SOL in lamports
        assetId: '0',          // Token A (SOL)
        privateKey: privateKey1,
        blinding: randomFieldElement(),
    };
    const commitment1 = await zkProver.computeCommitment(
        utxo1.amount,
        utxo1.assetId,
        pubkey1,
        utxo1.blinding
    );
    console.log('  UTXO 1 (1 SOL):', commitment1.substring(0, 20) + '...');

    // UTXO 2: Empty (dummy input)
    const utxo2 = {
        amount: '0',
        assetId: '0',
        privateKey: privateKey2,
        blinding: randomFieldElement(),
    };
    const commitment2 = await zkProver.computeCommitment(
        utxo2.amount,
        utxo2.assetId,
        pubkey2,
        utxo2.blinding
    );
    console.log('  UTXO 2 (empty):', commitment2.substring(0, 20) + '...');
    console.log('');

    // Insert commitments into Merkle tree
    console.log('Building Merkle tree...');
    const index1 = tree.insert(commitment1);
    const index2 = tree.insert(commitment2);
    const root = tree.getRoot().toString();
    console.log('  Merkle root:', root.substring(0, 20) + '...');
    console.log('  UTXO 1 index:', index1);
    console.log('  UTXO 2 index:', index2);
    console.log('');

    // Get Merkle proofs
    const proof1 = tree.getProof(index1);
    const proof2 = tree.getProof(index2);

    // Verify proofs locally
    console.log('Verifying Merkle proofs...');
    const valid1 = tree.verifyProof(commitment1, proof1.pathElements, proof1.pathIndices);
    const valid2 = tree.verifyProof(commitment2, proof2.pathElements, proof2.pathIndices);
    console.log('  UTXO 1 proof valid:', valid1);
    console.log('  UTXO 2 proof valid:', valid2);
    console.log('');

    // Prepare swap parameters
    console.log('Preparing swap...');
    const swapAmountIn = '100000000';   // 0.1 SOL

    // Pool state (before swap)
    const poolState = {
        reserveA: '10000000000000',   // 10000 SOL
        reserveB: '1500000000000',    // 1.5M USDC
        poolPubkey: randomFieldElement(),
        poolBlinding: randomFieldElement(),
    };

    // Calculate swap output using constant product formula with 0.3% fee
    // dy = (y * dx * 997) / (x * 1000 + dx * 997)
    const dx = BigInt(swapAmountIn);
    const x = BigInt(poolState.reserveA);
    const y = BigInt(poolState.reserveB);
    const swapAmountOutBigInt = (y * dx * 997n) / (x * 1000n + dx * 997n);
    const swapAmountOut = swapAmountOutBigInt.toString();

    console.log('  Calculated output:', Number(swapAmountOut) / 1e6, 'USDC');

    // New pool state (after swap)
    const newPoolState = {
        reserveA: (BigInt(poolState.reserveA) + BigInt(swapAmountIn)).toString(),
        reserveB: (BigInt(poolState.reserveB) - BigInt(swapAmountOut)).toString(),
        poolBlinding: randomFieldElement(),
    };

    // Verify k increases (due to fee)
    const kBefore = BigInt(poolState.reserveA) * BigInt(poolState.reserveB);
    const kAfter = BigInt(newPoolState.reserveA) * BigInt(newPoolState.reserveB);
    console.log('  k_before:', kBefore.toString().substring(0, 20) + '...');
    console.log('  k_after:', kAfter.toString().substring(0, 20) + '...');
    console.log('  k increased:', kAfter >= kBefore);

    console.log('  Swap: 0.1 SOL -> 15 USDC');
    console.log('  Pool reserves: ' +
        (Number(poolState.reserveA) / 1e9).toFixed(2) + ' SOL / ' +
        (Number(poolState.reserveB) / 1e6).toFixed(2) + ' USDC');
    console.log('');

    // Input UTXOs with Merkle proofs
    const inputUtxos = [
        {
            ...utxo1,
            pathElements: proof1.pathElements,
            pathIndices: proof1.pathIndices,
        },
        {
            ...utxo2,
            pathElements: proof2.pathElements,
            pathIndices: proof2.pathIndices,
        },
    ];

    // Output UTXOs
    // User gets: remaining SOL + swapped USDC
    const outputUtxos = [
        {
            amount: (BigInt(utxo1.amount) - BigInt(swapAmountIn)).toString(),  // 0.9 SOL
            assetId: '0',
            pubkey: pubkey1,
            blinding: randomFieldElement(),
        },
        {
            amount: swapAmountOut,  // 15 USDC
            assetId: '1',           // Token B
            pubkey: pubkey1,
            blinding: randomFieldElement(),
        },
    ];

    // Swap params
    const swapParams = {
        amountIn: swapAmountIn,
        assetIn: '0',
        amountOut: swapAmountOut,
        minAmountOut: swapAmountOut,
    };

    // External data hash (prevents tx malleability)
    const extDataHash = randomFieldElement();

    // Generate ZK proof
    console.log('Generating ZK proof...');
    console.log('(This may take 30-60 seconds)');
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
        console.log('');
        console.log('  Proof generated in', elapsed.toFixed(2), 'seconds!');
        console.log('');

        // Display proof info
        console.log('Proof components:');
        console.log('  pi_a: [' + result.proof.pi_a[0].substring(0, 20) + '..., ...]');
        console.log('  pi_b: [[...], [...]]');
        console.log('  pi_c: [' + result.proof.pi_c[0].substring(0, 20) + '..., ...]');
        console.log('');

        // Display public signals
        console.log('Public signals:');
        console.log('  [0] root:', result.publicSignals[0].substring(0, 20) + '...');
        console.log('  [1-2] nullifiers');
        console.log('  [3-4] output commitments');
        console.log('  [5] pool state hash');
        console.log('  [6] new pool state hash');
        console.log('  [7] ext data hash');
        console.log('');

        // Verify locally
        console.log('Verifying proof locally...');
        const valid = await zkProver.verifyProofLocal(result.proof, result.publicSignals);
        console.log('  Verification:', valid ? 'PASSED' : 'FAILED');
        console.log('');

        if (valid) {
            // Format for Solana
            console.log('Formatting for Solana...');
            const proofBytes = zkProver.formatProofForSolana(result.proof);
            const signalsBytes = zkProver.formatPublicSignalsForSolana(result.publicSignals);

            console.log('  Proof bytes:', proofBytes.length, 'bytes');
            console.log('  Signals bytes:', signalsBytes.length, 'bytes');
            console.log('  Total instruction data:', proofBytes.length + signalsBytes.length, 'bytes');
            console.log('');

            // Save proof to file
            const fs = require('fs');
            const proofData = {
                proof: result.proof,
                publicSignals: result.publicSignals,
                inputNullifiers: result.inputNullifiers,
                outputCommitments: result.outputCommitments,
                root: root,
                proofBytesHex: proofBytes.toString('hex'),
                signalsBytesHex: signalsBytes.toString('hex'),
            };
            fs.writeFileSync('circuits/build/valid_proof.json', JSON.stringify(proofData, null, 2));
            console.log('Proof saved to circuits/build/valid_proof.json');
        }

        console.log('');
        console.log('='.repeat(60));
        console.log('ZK Swap Test Complete!');
        console.log('='.repeat(60));

    } catch (err) {
        console.error('');
        console.error('Error generating proof:', err.message);
        console.error('');
        console.error('Stack:', err.stack);
    }
}

main().catch(console.error);
