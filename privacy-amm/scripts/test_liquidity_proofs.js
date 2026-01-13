/**
 * Test Private Liquidity Proofs
 *
 * Tests:
 * 1. Add liquidity proof generation and verification
 * 2. Remove liquidity proof generation and verification
 */

const crypto = require('crypto');
const zkProver = require('../sdk/zk_prover');
const { createMerkleTree } = require('../sdk/merkle_tree');

// Generate random field element
function randomFieldElement() {
    const bytes = crypto.randomBytes(31);
    return BigInt('0x' + bytes.toString('hex')).toString();
}

async function testAddLiquidity() {
    console.log('='.repeat(60));
    console.log('Test: Private Add Liquidity');
    console.log('='.repeat(60));
    console.log('');

    // Initialize
    await zkProver.initPoseidon();
    const tree = await createMerkleTree(20);

    // Create user keys
    const privateKeyA = randomFieldElement();
    const privateKeyB = randomFieldElement();
    const pubkeyA = await zkProver.derivePublicKey(privateKeyA);
    const pubkeyB = await zkProver.derivePublicKey(privateKeyB);

    // User's UTXO: Token A (1000 tokens)
    const utxoA = {
        amount: '1000000000',  // 1000 with 6 decimals
        privateKey: privateKeyA,
        blinding: randomFieldElement(),
    };
    const commitmentA = await zkProver.computeCommitment(
        utxoA.amount,
        '0',  // Token A
        pubkeyA,
        utxoA.blinding
    );

    // User's UTXO: Token B (1500 tokens)
    const utxoB = {
        amount: '1500000000',  // 1500 with 6 decimals
        privateKey: privateKeyB,
        blinding: randomFieldElement(),
    };
    const commitmentB = await zkProver.computeCommitment(
        utxoB.amount,
        '1',  // Token B
        pubkeyB,
        utxoB.blinding
    );

    // Insert UTXOs into Merkle tree
    const indexA = tree.insert(commitmentA);
    const indexB = tree.insert(commitmentB);
    const root = tree.getRoot().toString();
    console.log('Merkle root:', root.substring(0, 20) + '...');
    console.log('UTXO A index:', indexA);
    console.log('UTXO B index:', indexB);

    // Get Merkle proofs
    const proofA = tree.getProof(indexA);
    const proofB = tree.getProof(indexB);

    // Pool state (before adding liquidity)
    const poolState = {
        reserveA: '10000000000',   // 10000 Token A
        reserveB: '15000000000',   // 15000 Token B
        poolPubkey: randomFieldElement(),
        poolBlinding: randomFieldElement(),
    };

    // LP state (before adding liquidity)
    const lpState = {
        totalLpSupply: '12247448713',  // sqrt(10000 * 15000) * 10^6
        lpPoolPubkey: randomFieldElement(),
        lpBlinding: randomFieldElement(),
    };

    // Calculate LP tokens to mint
    // LP = amountA * totalLpSupply / reserveA
    const lpMinted = (BigInt(utxoA.amount) * BigInt(lpState.totalLpSupply) / BigInt(poolState.reserveA)).toString();
    console.log('LP tokens to mint:', lpMinted);

    // New pool state (after adding liquidity)
    const newPoolState = {
        reserveA: (BigInt(poolState.reserveA) + BigInt(utxoA.amount)).toString(),
        reserveB: (BigInt(poolState.reserveB) + BigInt(utxoB.amount)).toString(),
        poolBlinding: randomFieldElement(),
    };

    // New LP state
    const newLpState = {
        totalLpSupply: (BigInt(lpState.totalLpSupply) + BigInt(lpMinted)).toString(),
        lpBlinding: randomFieldElement(),
    };

    // Output LP Token UTXO
    const outputUtxo = {
        lpAmount: lpMinted,
        pubkey: pubkeyA,  // User's public key
        blinding: randomFieldElement(),
    };

    console.log('');
    console.log('Generating add liquidity proof...');
    const startTime = Date.now();

    try {
        const result = await zkProver.generateAddLiquidityProof({
            root,
            inputUtxos: [
                { ...utxoA, pathElements: proofA.pathElements, pathIndices: proofA.pathIndices },
                { ...utxoB, pathElements: proofB.pathElements, pathIndices: proofB.pathIndices },
            ],
            outputUtxo,
            poolState,
            newPoolState,
            lpState,
            newLpState,
            extDataHash: randomFieldElement(),
        });

        console.log('Proof generated in', ((Date.now() - startTime) / 1000).toFixed(2), 'seconds');

        // Verify locally
        console.log('');
        console.log('Verifying proof locally...');
        const valid = await zkProver.verifyAddLiquidityProofLocal(result.proof, result.publicSignals);
        console.log('Verification:', valid ? 'PASSED' : 'FAILED');

        if (!valid) {
            console.error('Add liquidity proof verification failed!');
            return null;
        }

        return result;

    } catch (err) {
        console.error('Add liquidity proof generation failed:', err.message);
        if (err.stack) {
            console.error(err.stack);
        }
        return null;
    }
}

async function testRemoveLiquidity() {
    console.log('');
    console.log('='.repeat(60));
    console.log('Test: Private Remove Liquidity');
    console.log('='.repeat(60));
    console.log('');

    // Initialize
    await zkProver.initPoseidon();
    const tree = await createMerkleTree(20);

    // Create user keys
    const privateKey = randomFieldElement();
    const pubkey = await zkProver.derivePublicKey(privateKey);

    // User's LP Token UTXO
    const lpAmount = '1000000000';  // 1000 LP tokens with 6 decimals
    const inputUtxo = {
        lpAmount,
        privateKey,
        blinding: randomFieldElement(),
    };
    const lpCommitment = await zkProver.computeCommitment(
        inputUtxo.lpAmount,
        '2',  // LP Token
        pubkey,
        inputUtxo.blinding
    );

    // Insert LP UTXO into Merkle tree
    const index = tree.insert(lpCommitment);
    const root = tree.getRoot().toString();
    console.log('Merkle root:', root.substring(0, 20) + '...');
    console.log('LP UTXO index:', index);

    // Get Merkle proof
    const proof = tree.getProof(index);

    // Pool state (before removing liquidity)
    const poolState = {
        reserveA: '10000000000',   // 10000 Token A
        reserveB: '15000000000',   // 15000 Token B
        poolPubkey: randomFieldElement(),
        poolBlinding: randomFieldElement(),
    };

    // LP state (before removing liquidity)
    const totalLpSupply = '12247448713';  // sqrt(10000 * 15000) * 10^6
    const lpState = {
        totalLpSupply,
        lpPoolPubkey: randomFieldElement(),
        lpBlinding: randomFieldElement(),
    };

    // Calculate tokens to receive
    // amountA = lpAmount * reserveA / totalLpSupply
    const amountA = (BigInt(lpAmount) * BigInt(poolState.reserveA) / BigInt(totalLpSupply)).toString();
    const amountB = (BigInt(lpAmount) * BigInt(poolState.reserveB) / BigInt(totalLpSupply)).toString();
    console.log('Token A to receive:', amountA);
    console.log('Token B to receive:', amountB);

    // New pool state (after removing liquidity)
    const newPoolState = {
        reserveA: (BigInt(poolState.reserveA) - BigInt(amountA)).toString(),
        reserveB: (BigInt(poolState.reserveB) - BigInt(amountB)).toString(),
        poolBlinding: randomFieldElement(),
    };

    // New LP state
    const newLpState = {
        totalLpSupply: (BigInt(totalLpSupply) - BigInt(lpAmount)).toString(),
        lpBlinding: randomFieldElement(),
    };

    // Output UTXOs
    const outputUtxos = [
        {
            amount: amountA,
            pubkey: pubkey,
            blinding: randomFieldElement(),
        },
        {
            amount: amountB,
            pubkey: pubkey,
            blinding: randomFieldElement(),
        },
    ];

    console.log('');
    console.log('Generating remove liquidity proof...');
    const startTime = Date.now();

    try {
        const result = await zkProver.generateRemoveLiquidityProof({
            root,
            inputUtxo: {
                ...inputUtxo,
                pathElements: proof.pathElements,
                pathIndices: proof.pathIndices,
            },
            outputUtxos,
            poolState,
            newPoolState,
            lpState,
            newLpState,
            extDataHash: randomFieldElement(),
        });

        console.log('Proof generated in', ((Date.now() - startTime) / 1000).toFixed(2), 'seconds');

        // Verify locally
        console.log('');
        console.log('Verifying proof locally...');
        const valid = await zkProver.verifyRemoveLiquidityProofLocal(result.proof, result.publicSignals);
        console.log('Verification:', valid ? 'PASSED' : 'FAILED');

        if (!valid) {
            console.error('Remove liquidity proof verification failed!');
            return null;
        }

        return result;

    } catch (err) {
        console.error('Remove liquidity proof generation failed:', err.message);
        if (err.stack) {
            console.error(err.stack);
        }
        return null;
    }
}

async function main() {
    console.log('');
    console.log('#'.repeat(60));
    console.log('# Privacy AMM - Liquidity Proof Tests');
    console.log('#'.repeat(60));
    console.log('');

    // Test Add Liquidity
    const addResult = await testAddLiquidity();
    if (!addResult) {
        console.log('');
        console.log('Add liquidity test FAILED');
        process.exit(1);
    }

    // Test Remove Liquidity
    const removeResult = await testRemoveLiquidity();
    if (!removeResult) {
        console.log('');
        console.log('Remove liquidity test FAILED');
        process.exit(1);
    }

    console.log('');
    console.log('#'.repeat(60));
    console.log('# All Tests PASSED!');
    console.log('#'.repeat(60));
    console.log('');
}

main().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
