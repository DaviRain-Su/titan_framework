/**
 * Test On-Chain ZK Verification
 * Sends a valid proof to the deployed Privacy AMM program
 */

const {
    Connection,
    PublicKey,
    Keypair,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
    SystemProgram,
} = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

// Load proof data
const proofPath = path.join(__dirname, '../circuits/build/valid_proof.json');
const proofData = JSON.parse(fs.readFileSync(proofPath, 'utf8'));

// Load pool accounts (if available)
const accountsPath = path.join(__dirname, '../circuits/build/pool_accounts.json');
let poolAccounts = null;
try {
    poolAccounts = JSON.parse(fs.readFileSync(accountsPath, 'utf8'));
} catch (e) {
    // Accounts not saved yet
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

// Program ID (deployed to testnet)
const PROGRAM_ID = new PublicKey('4kdRYKh8ohj6HGeqmNX7coby3AKf3Yc4s85WPEPYjzrB');

// Instruction discriminator for Swap = 3
const SWAP_INSTRUCTION = 3;

async function main() {
    console.log('='.repeat(60));
    console.log('On-Chain ZK Verification Test');
    console.log('='.repeat(60));
    console.log('');

    // Connect to testnet
    const connection = new Connection('https://api.testnet.solana.com', 'confirmed');
    console.log('Connected to testnet');

    // Load keypair
    const keypairPath = path.join(process.env.HOME, '.config/solana/id.json');
    const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
    const payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    console.log('Payer:', payer.publicKey.toBase58());

    // Check balance
    const balance = await connection.getBalance(payer.publicKey);
    console.log('Balance:', balance / 1e9, 'SOL');
    console.log('');

    if (balance < 0.01 * 1e9) {
        console.log('Insufficient balance. Please airdrop SOL:');
        console.log('  solana airdrop 1');
        return;
    }

    // Load pool accounts
    console.log('Loading pool accounts...');

    if (!poolAccounts) {
        console.log('Pool accounts not found. Run init_pool.js first.');
        return;
    }

    const poolAccount = new PublicKey(poolAccounts.poolAccount);
    const merkleAccount = new PublicKey(poolAccounts.merkleAccount);
    const nullifierAccount = new PublicKey(poolAccounts.nullifierAccount);

    console.log('Pool Account:', poolAccount.toBase58());
    console.log('Merkle Account:', merkleAccount.toBase58());
    console.log('Nullifier Account:', nullifierAccount.toBase58());
    console.log('');

    // Build instruction data
    console.log('Building swap instruction...');

    // SwapParams structure (from pool.zig):
    // - proof: 256 bytes (pi_a[64] + pi_b[128] + pi_c[64])
    // - public_inputs: 256 bytes (8 x 32 bytes)
    // - nullifiers: 64 bytes (2 x 32)
    // - new_commitments: 64 bytes (2 x 32)
    // - new_pool_state_hash: 32 bytes
    // - new_blinding: 32 bytes
    // Total: 704 bytes

    // Proof bytes (256 bytes)
    const proofBytes = Buffer.from(proofData.proofBytesHex, 'hex');
    console.log('Proof bytes:', proofBytes.length);

    // Public signals bytes (256 bytes for 8 signals)
    const signalsBytes = Buffer.from(proofData.signalsBytesHex, 'hex');
    console.log('Signals bytes:', signalsBytes.length);

    // Extract nullifiers from proof data (2 x 32 bytes)
    const nullifier0 = decimalTo32Bytes(proofData.inputNullifiers[0]);
    const nullifier1 = decimalTo32Bytes(proofData.inputNullifiers[1]);
    const nullifiersBytes = Buffer.concat([nullifier0, nullifier1]);
    console.log('Nullifiers bytes:', nullifiersBytes.length);

    // Extract commitments from proof data (2 x 32 bytes)
    const commitment0 = decimalTo32Bytes(proofData.outputCommitments[0]);
    const commitment1 = decimalTo32Bytes(proofData.outputCommitments[1]);
    const commitmentsBytes = Buffer.concat([commitment0, commitment1]);
    console.log('Commitments bytes:', commitmentsBytes.length);

    // New pool state hash (from public signals[6])
    const newPoolStateHash = decimalTo32Bytes(proofData.publicSignals[6]);
    console.log('New pool state hash bytes:', newPoolStateHash.length);

    // New blinding (32 bytes random)
    const newBlinding = Buffer.alloc(32);
    require('crypto').randomFillSync(newBlinding);
    console.log('New blinding bytes:', newBlinding.length);

    // Build instruction data: [discriminator, proof, signals, nullifiers, commitments, new_pool_hash, new_blinding]
    const instructionData = Buffer.concat([
        Buffer.from([SWAP_INSTRUCTION]),
        proofBytes,
        signalsBytes,
        nullifiersBytes,
        commitmentsBytes,
        newPoolStateHash,
        newBlinding,
    ]);
    console.log('Total instruction data:', instructionData.length, 'bytes');
    console.log('');

    // Create swap instruction
    const swapInstruction = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: poolAccount, isSigner: false, isWritable: true },
            { pubkey: merkleAccount, isSigner: false, isWritable: true },
            { pubkey: nullifierAccount, isSigner: false, isWritable: true },
        ],
        data: instructionData,
    });

    // Check if accounts exist
    console.log('Checking account states...');
    const poolInfo = await connection.getAccountInfo(poolAccount);
    const merkleInfo = await connection.getAccountInfo(merkleAccount);
    const nullifierInfo = await connection.getAccountInfo(nullifierAccount);

    if (!poolInfo || !merkleInfo || !nullifierInfo) {
        console.log('');
        console.log('Pool accounts not initialized. Need to initialize first.');
        console.log('Pool exists:', !!poolInfo);
        console.log('Merkle exists:', !!merkleInfo);
        console.log('Nullifier exists:', !!nullifierInfo);
        console.log('');
        console.log('Run the initialization script first:');
        console.log('  node scripts/init_pool.js');
        return;
    }

    console.log('Pool data size:', poolInfo.data.length);
    console.log('Merkle data size:', merkleInfo.data.length);
    console.log('Nullifier data size:', nullifierInfo.data.length);
    console.log('');

    // Send transaction
    console.log('Sending swap transaction...');
    const transaction = new Transaction().add(swapInstruction);

    try {
        const signature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [payer],
            { commitment: 'confirmed' }
        );

        console.log('');
        console.log('Transaction successful!');
        console.log('Signature:', signature);
        console.log('Explorer:', `https://explorer.solana.com/tx/${signature}?cluster=testnet`);
        console.log('');
        console.log('='.repeat(60));
        console.log('On-Chain ZK Verification: PASSED');
        console.log('='.repeat(60));

    } catch (err) {
        console.log('');
        console.log('Transaction failed:', err.message);

        if (err.logs) {
            console.log('');
            console.log('Program logs:');
            err.logs.forEach(log => console.log('  ', log));
        }

        // Parse error
        if (err.message.includes('InvalidProof')) {
            console.log('');
            console.log('The ZK proof verification failed on-chain.');
            console.log('This could mean:');
            console.log('  1. The proof is invalid');
            console.log('  2. The public inputs dont match');
            console.log('  3. The verification key is incorrect');
        }
    }
}

main().catch(console.error);
