/**
 * End-to-End ZK Swap Test
 *
 * Flow:
 * 1. Deposit UTXOs to build Merkle tree
 * 2. Generate ZK proof with valid Merkle proofs
 * 3. Submit swap transaction with proof
 */

const {
    Connection,
    PublicKey,
    Keypair,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
} = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zkProver = require('../sdk/zk_prover');
const { createMerkleTree } = require('../sdk/merkle_tree');

// Program ID (fixed nullifier set size)
const PROGRAM_ID = new PublicKey('7PGfSGUnUhw3qehV64q3C7DnZfcCWHpAxrhoKxTCJHKp');

// Instructions
const DEPOSIT_INSTRUCTION = 1;
const SWAP_INSTRUCTION = 3;

// Load pool accounts
const accountsPath = path.join(__dirname, '../circuits/build/pool_accounts.json');
const poolAccounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));

// Generate random field element
function randomFieldElement() {
    const bytes = crypto.randomBytes(31);
    return BigInt('0x' + bytes.toString('hex')).toString();
}

// Convert decimal string to 32-byte little-endian buffer
function decimalTo32Bytes(decimal) {
    const buf = Buffer.alloc(32);
    let value = BigInt(decimal);
    for (let i = 0; i < 32; i++) {
        buf[i] = Number(value & 0xFFn);
        value >>= 8n;
    }
    return buf;
}

async function main() {
    console.log('='.repeat(60));
    console.log('End-to-End ZK Swap Test');
    console.log('='.repeat(60));
    console.log('');

    // Connect
    const connection = new Connection('https://api.testnet.solana.com', 'confirmed');
    console.log('Connected to testnet');

    // Load payer
    const keypairPath = path.join(process.env.HOME, '.config/solana/id.json');
    const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
    const payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    console.log('Payer:', payer.publicKey.toBase58());
    console.log('');

    // Load accounts
    const poolAccount = new PublicKey(poolAccounts.poolAccount);
    const merkleAccount = new PublicKey(poolAccounts.merkleAccount);
    const nullifierAccount = new PublicKey(poolAccounts.nullifierAccount);

    // ============================================================
    // Step 1: Initialize ZK tools
    // ============================================================
    console.log('Step 1: Initializing Poseidon and Merkle tree...');
    await zkProver.initPoseidon();
    const tree = await createMerkleTree(20);
    console.log('Done.');
    console.log('');

    // ============================================================
    // Step 2: Create user keys and UTXOs
    // ============================================================
    console.log('Step 2: Creating user keys and UTXOs...');

    const privateKey1 = randomFieldElement();
    const privateKey2 = randomFieldElement();
    const pubkey1 = await zkProver.derivePublicKey(privateKey1);
    const pubkey2 = await zkProver.derivePublicKey(privateKey2);

    // UTXO 1: 1 SOL
    const utxo1 = {
        amount: '1000000000',
        assetId: '0',
        privateKey: privateKey1,
        blinding: randomFieldElement(),
    };
    const commitment1 = await zkProver.computeCommitment(
        utxo1.amount,
        utxo1.assetId,
        pubkey1,
        utxo1.blinding
    );
    console.log('  UTXO 1 commitment:', commitment1.substring(0, 20) + '...');

    // UTXO 2: Empty
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
    console.log('  UTXO 2 commitment:', commitment2.substring(0, 20) + '...');
    console.log('');

    // ============================================================
    // Step 3: Deposit UTXOs on-chain
    // ============================================================
    console.log('Step 3: Depositing UTXOs on-chain...');

    // Deposit UTXO 1
    const deposit1Data = Buffer.concat([
        Buffer.from([DEPOSIT_INSTRUCTION]),
        decimalTo32Bytes(commitment1),
        Buffer.alloc(8),  // amount (u64 = 0 for test)
        Buffer.from([0]), // asset_type
    ]);

    const deposit1Ix = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: false },
            { pubkey: poolAccount, isSigner: false, isWritable: true },
            { pubkey: merkleAccount, isSigner: false, isWritable: true },
        ],
        data: deposit1Data,
    });

    // Deposit UTXO 2
    const deposit2Data = Buffer.concat([
        Buffer.from([DEPOSIT_INSTRUCTION]),
        decimalTo32Bytes(commitment2),
        Buffer.alloc(8),  // amount
        Buffer.from([0]), // asset_type
    ]);

    const deposit2Ix = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: false },
            { pubkey: poolAccount, isSigner: false, isWritable: true },
            { pubkey: merkleAccount, isSigner: false, isWritable: true },
        ],
        data: deposit2Data,
    });

    // Submit deposits
    const depositTx = new Transaction().add(deposit1Ix).add(deposit2Ix);
    try {
        const depositSig = await sendAndConfirmTransaction(
            connection,
            depositTx,
            [payer],
            { commitment: 'confirmed' }
        );
        console.log('  Deposits successful:', depositSig.substring(0, 20) + '...');
    } catch (err) {
        console.error('  Deposit failed:', err.message);
        if (err.logs) {
            err.logs.forEach(log => console.log('    ', log));
        }
        return;
    }
    console.log('');

    // ============================================================
    // Step 4: Build local Merkle tree with same commitments
    // ============================================================
    console.log('Step 4: Building local Merkle tree...');
    const index1 = tree.insert(commitment1);
    const index2 = tree.insert(commitment2);
    const root = tree.getRoot().toString();
    console.log('  Merkle root:', root.substring(0, 20) + '...');
    console.log('  UTXO 1 index:', index1);
    console.log('  UTXO 2 index:', index2);

    // Get Merkle proofs
    const proof1 = tree.getProof(index1);
    const proof2 = tree.getProof(index2);
    console.log('  Proofs generated');
    console.log('');

    // ============================================================
    // Step 5: Prepare swap parameters
    // ============================================================
    console.log('Step 5: Preparing swap parameters...');

    const swapAmountIn = '100000000';   // 0.1 SOL

    // Pool state
    const poolState = {
        reserveA: '10000000000000',
        reserveB: '1500000000000',
        poolPubkey: randomFieldElement(),
        poolBlinding: randomFieldElement(),
    };

    // Calculate output
    const dx = BigInt(swapAmountIn);
    const x = BigInt(poolState.reserveA);
    const y = BigInt(poolState.reserveB);
    const swapAmountOut = ((y * dx * 997n) / (x * 1000n + dx * 997n)).toString();

    console.log('  Swap: 0.1 SOL ->',  Number(swapAmountOut) / 1e6, 'USDC');

    // New pool state
    const newPoolState = {
        reserveA: (BigInt(poolState.reserveA) + BigInt(swapAmountIn)).toString(),
        reserveB: (BigInt(poolState.reserveB) - BigInt(swapAmountOut)).toString(),
        poolBlinding: randomFieldElement(),
    };
    console.log('');

    // ============================================================
    // Step 6: Generate ZK proof
    // ============================================================
    console.log('Step 6: Generating ZK proof...');
    console.log('  (This may take 30-60 seconds)');

    const inputUtxos = [
        { ...utxo1, pathElements: proof1.pathElements, pathIndices: proof1.pathIndices },
        { ...utxo2, pathElements: proof2.pathElements, pathIndices: proof2.pathIndices },
    ];

    const outputUtxos = [
        {
            amount: (BigInt(utxo1.amount) - BigInt(swapAmountIn)).toString(),
            assetId: '0',
            pubkey: pubkey1,
            blinding: randomFieldElement(),
        },
        {
            amount: swapAmountOut,
            assetId: '1',
            pubkey: pubkey1,
            blinding: randomFieldElement(),
        },
    ];

    const swapParams = {
        amountIn: swapAmountIn,
        assetIn: '0',
        amountOut: swapAmountOut,
        minAmountOut: swapAmountOut,
    };

    const extDataHash = randomFieldElement();

    const startTime = Date.now();
    let result;
    try {
        result = await zkProver.generateSwapProof({
            root,
            inputUtxos,
            outputUtxos,
            poolState,
            newPoolState,
            swapParams,
            extDataHash,
        });
        console.log('  Proof generated in', ((Date.now() - startTime) / 1000).toFixed(2), 'seconds');
    } catch (err) {
        console.error('  Proof generation failed:', err.message);
        return;
    }
    console.log('');

    // ============================================================
    // Step 7: Verify locally
    // ============================================================
    console.log('Step 7: Verifying proof locally...');
    const valid = await zkProver.verifyProofLocal(result.proof, result.publicSignals);
    console.log('  Local verification:', valid ? 'PASSED' : 'FAILED');
    if (!valid) {
        console.error('  Local verification failed, not submitting on-chain');
        return;
    }
    console.log('');

    // ============================================================
    // Step 8: Submit swap transaction
    // ============================================================
    console.log('Step 8: Submitting swap transaction...');

    // Format proof for Solana
    const proofBytes = zkProver.formatProofForSolana(result.proof);
    const signalsBytes = zkProver.formatPublicSignalsForSolana(result.publicSignals);

    // Build swap instruction data
    const nullifier0 = decimalTo32Bytes(result.inputNullifiers[0]);
    const nullifier1 = decimalTo32Bytes(result.inputNullifiers[1]);
    const commitment0 = decimalTo32Bytes(result.outputCommitments[0]);
    const commitmentOut1 = decimalTo32Bytes(result.outputCommitments[1]);
    const newPoolHash = decimalTo32Bytes(result.newPoolStateHash);
    const newBlinding = decimalTo32Bytes(newPoolState.poolBlinding);

    const swapData = Buffer.concat([
        Buffer.from([SWAP_INSTRUCTION]),
        proofBytes,
        signalsBytes,
        nullifier0,
        nullifier1,
        commitment0,
        commitmentOut1,
        newPoolHash,
        newBlinding,
    ]);

    console.log('  Instruction data:', swapData.length, 'bytes');

    const swapIx = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: poolAccount, isSigner: false, isWritable: true },
            { pubkey: merkleAccount, isSigner: false, isWritable: true },
            { pubkey: nullifierAccount, isSigner: false, isWritable: true },
        ],
        data: swapData,
    });

    const swapTx = new Transaction().add(swapIx);

    try {
        const swapSig = await sendAndConfirmTransaction(
            connection,
            swapTx,
            [payer],
            { commitment: 'confirmed' }
        );

        console.log('');
        console.log('='.repeat(60));
        console.log('ZK Swap Transaction Successful!');
        console.log('='.repeat(60));
        console.log('Signature:', swapSig);
        console.log('Explorer:', `https://explorer.solana.com/tx/${swapSig}?cluster=testnet`);

    } catch (err) {
        console.log('');
        console.log('Transaction failed:', err.message);
        if (err.logs) {
            console.log('Program logs:');
            err.logs.forEach(log => console.log('  ', log));
        }

        // Debug info
        console.log('');
        console.log('Debug info:');
        console.log('  Proof root:', root.substring(0, 20) + '...');
        console.log('  Signal[0] (root):', result.publicSignals[0].substring(0, 20) + '...');
    }
}

main().catch(console.error);
