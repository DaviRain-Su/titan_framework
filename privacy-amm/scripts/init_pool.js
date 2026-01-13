/**
 * Initialize Privacy AMM Pool Accounts
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
const crypto = require('crypto');

// Program ID (deployed to testnet - fixed nullifier set size)
const PROGRAM_ID = new PublicKey('7PGfSGUnUhw3qehV64q3C7DnZfcCWHpAxrhoKxTCJHKp');

// Instruction discriminator for InitializePool = 0
const INIT_INSTRUCTION = 0;

// Account sizes
const POOL_STATE_SIZE = 162;     // PoolState::SIZE from pool.zig
const MERKLE_STATE_SIZE = 8192;  // Merkle tree state
const NULLIFIER_SET_SIZE = 4096; // Nullifier bitmap

async function main() {
    console.log('='.repeat(60));
    console.log('Initialize Privacy AMM Pool');
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

    if (balance < 0.1 * 1e9) {
        console.log('Insufficient balance. Please airdrop SOL:');
        console.log('  solana airdrop 2 --url testnet');
        return;
    }

    // Create account keypairs
    const poolAccount = Keypair.generate();
    const merkleAccount = Keypair.generate();
    const nullifierAccount = Keypair.generate();

    console.log('Creating accounts...');
    console.log('Pool Account:', poolAccount.publicKey.toBase58());
    console.log('Merkle Account:', merkleAccount.publicKey.toBase58());
    console.log('Nullifier Account:', nullifierAccount.publicKey.toBase58());
    console.log('');

    // Get minimum rent
    const poolRent = await connection.getMinimumBalanceForRentExemption(POOL_STATE_SIZE);
    const merkleRent = await connection.getMinimumBalanceForRentExemption(MERKLE_STATE_SIZE);
    const nullifierRent = await connection.getMinimumBalanceForRentExemption(NULLIFIER_SET_SIZE);

    console.log('Rent requirements:');
    console.log('  Pool:', poolRent / 1e9, 'SOL');
    console.log('  Merkle:', merkleRent / 1e9, 'SOL');
    console.log('  Nullifier:', nullifierRent / 1e9, 'SOL');
    console.log('  Total:', (poolRent + merkleRent + nullifierRent) / 1e9, 'SOL');
    console.log('');

    // Create accounts transaction
    const createAccountsTx = new Transaction();

    // Create pool account
    createAccountsTx.add(
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: poolAccount.publicKey,
            lamports: poolRent,
            space: POOL_STATE_SIZE,
            programId: PROGRAM_ID,
        })
    );

    // Create merkle account
    createAccountsTx.add(
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: merkleAccount.publicKey,
            lamports: merkleRent,
            space: MERKLE_STATE_SIZE,
            programId: PROGRAM_ID,
        })
    );

    // Create nullifier account
    createAccountsTx.add(
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: nullifierAccount.publicKey,
            lamports: nullifierRent,
            space: NULLIFIER_SET_SIZE,
            programId: PROGRAM_ID,
        })
    );

    console.log('Creating accounts on chain...');
    try {
        const createSig = await sendAndConfirmTransaction(
            connection,
            createAccountsTx,
            [payer, poolAccount, merkleAccount, nullifierAccount],
            { commitment: 'confirmed' }
        );
        console.log('Accounts created:', createSig);
    } catch (err) {
        console.error('Failed to create accounts:', err.message);
        return;
    }
    console.log('');

    // Build initialization instruction data
    // InitializeParams from pool.zig:
    // - token_a_mint: [32]u8
    // - token_b_mint: [32]u8
    // - pool_pubkey: [32]u8
    // - initial_blinding: [32]u8
    // - bump: u8
    // Total: 129 bytes

    const tokenAMint = Buffer.alloc(32);  // Dummy token A mint
    crypto.randomFillSync(tokenAMint);

    const tokenBMint = Buffer.alloc(32);  // Dummy token B mint
    crypto.randomFillSync(tokenBMint);

    const poolPubkey = poolAccount.publicKey.toBuffer();

    const initialBlinding = Buffer.alloc(32);  // Random blinding
    crypto.randomFillSync(initialBlinding);

    const bump = 255;  // Dummy bump

    const initData = Buffer.concat([
        Buffer.from([INIT_INSTRUCTION]),
        tokenAMint,
        tokenBMint,
        poolPubkey,
        initialBlinding,
        Buffer.from([bump]),
    ]);

    console.log('Initializing pool...');
    console.log('Init data size:', initData.length, 'bytes');

    const initInstruction = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: false },
            { pubkey: poolAccount.publicKey, isSigner: false, isWritable: true },
            { pubkey: merkleAccount.publicKey, isSigner: false, isWritable: true },
            { pubkey: nullifierAccount.publicKey, isSigner: false, isWritable: true },
        ],
        data: initData,
    });

    const initTx = new Transaction().add(initInstruction);

    try {
        const initSig = await sendAndConfirmTransaction(
            connection,
            initTx,
            [payer],
            { commitment: 'confirmed' }
        );
        console.log('');
        console.log('Pool initialized successfully!');
        console.log('Signature:', initSig);
        console.log('Explorer:', `https://explorer.solana.com/tx/${initSig}?cluster=testnet`);
    } catch (err) {
        console.error('Failed to initialize pool:', err.message);
        if (err.logs) {
            console.log('Program logs:');
            err.logs.forEach(log => console.log('  ', log));
        }
        return;
    }

    // Save account info for later use
    const accountInfo = {
        programId: PROGRAM_ID.toBase58(),
        poolAccount: poolAccount.publicKey.toBase58(),
        merkleAccount: merkleAccount.publicKey.toBase58(),
        nullifierAccount: nullifierAccount.publicKey.toBase58(),
        poolSecretKey: Array.from(poolAccount.secretKey),
        merkleSecretKey: Array.from(merkleAccount.secretKey),
        nullifierSecretKey: Array.from(nullifierAccount.secretKey),
    };

    const accountInfoPath = path.join(__dirname, '../circuits/build/pool_accounts.json');
    fs.writeFileSync(accountInfoPath, JSON.stringify(accountInfo, null, 2));
    console.log('');
    console.log('Account info saved to:', accountInfoPath);

    console.log('');
    console.log('='.repeat(60));
    console.log('Pool Initialization Complete!');
    console.log('='.repeat(60));
}

main().catch(console.error);
