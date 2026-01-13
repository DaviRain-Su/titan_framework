/**
 * Privacy AMM On-Chain Test Script
 * 测试链上程序的真实交互
 */

const {
    Connection,
    PublicKey,
    Keypair,
    SystemProgram,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
} = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

// Configuration
const PROGRAM_ID = new PublicKey('5XNfzGiTt7WNveJrLRKcz2w9wyCDqLNMYHaQWZJjo8ef');
const RPC_URL = 'https://api.devnet.solana.com';

// Token mints
const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112'); // Native SOL (wrapped)
const TUSDC_MINT = new PublicKey('ESkAKdYXJyUueJ6SNa6p96kDvE2NJPdYbSrnk7F8mcqM');
const LP_MINT = new PublicKey('7E6wYnAphbMA2SjsCoE9VUc5MsJcSpz6BogHHke21d5Y');

// Account sizes
const POOL_SIZE = 162;
const MERKLE_SIZE = 1316;
const NULLIFIER_SIZE = 12000; // 10 (header) + 8192 (bloom) + ~1800 (overflow buffer)

// Instructions (must match lib.zig Instruction enum)
const INSTRUCTION = {
    InitializePool: 0,
    Deposit: 1,
    Withdraw: 2,
    Swap: 3,
    AddLiquidity: 4,
    RemoveLiquidity: 5,
};

// Instruction data format notes:
// - AddLiquidity: instruction(1) + amount_a(8) + amount_b(8) + min_lp(8) = 25 bytes
// - RemoveLiquidity: instruction(1) + lp_amount(8) + min_amount_a(8) + min_amount_b(8) = 25 bytes

async function main() {
    console.log('='.repeat(60));
    console.log('Privacy AMM On-Chain Test');
    console.log('='.repeat(60));
    console.log('');

    // Load payer keypair
    const keypairPath = path.join(process.env.HOME, '.config/solana/id.json');
    const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
    const payer = Keypair.fromSecretKey(new Uint8Array(keypairData));

    console.log('Payer:', payer.publicKey.toBase58());
    console.log('Program:', PROGRAM_ID.toBase58());
    console.log('');

    // Connect to devnet
    const connection = new Connection(RPC_URL, 'confirmed');
    const balance = await connection.getBalance(payer.publicKey);
    console.log('Balance:', balance / 1e9, 'SOL');
    console.log('');

    // Generate keypairs for accounts
    const poolAccount = Keypair.generate();
    const merkleAccount = Keypair.generate();
    const nullifierAccount = Keypair.generate();

    console.log('Pool Account:', poolAccount.publicKey.toBase58());
    console.log('Merkle Account:', merkleAccount.publicKey.toBase58());
    console.log('Nullifier Account:', nullifierAccount.publicKey.toBase58());
    console.log('');

    // Calculate rent
    const poolRent = await connection.getMinimumBalanceForRentExemption(POOL_SIZE);
    const merkleRent = await connection.getMinimumBalanceForRentExemption(MERKLE_SIZE);
    const nullifierRent = await connection.getMinimumBalanceForRentExemption(NULLIFIER_SIZE);

    console.log('Rent costs:');
    console.log('  Pool:', poolRent / 1e9, 'SOL');
    console.log('  Merkle:', merkleRent / 1e9, 'SOL');
    console.log('  Nullifier:', nullifierRent / 1e9, 'SOL');
    console.log('  Total:', (poolRent + merkleRent + nullifierRent) / 1e9, 'SOL');
    console.log('');

    // Step 1: Create accounts
    console.log('Step 1: Creating accounts...');

    const createAccountsTx = new Transaction();

    // Create pool account
    createAccountsTx.add(
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: poolAccount.publicKey,
            lamports: poolRent,
            space: POOL_SIZE,
            programId: PROGRAM_ID,
        })
    );

    // Create merkle account
    createAccountsTx.add(
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: merkleAccount.publicKey,
            lamports: merkleRent,
            space: MERKLE_SIZE,
            programId: PROGRAM_ID,
        })
    );

    // Create nullifier account
    createAccountsTx.add(
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: nullifierAccount.publicKey,
            lamports: nullifierRent,
            space: NULLIFIER_SIZE,
            programId: PROGRAM_ID,
        })
    );

    try {
        const createSig = await sendAndConfirmTransaction(
            connection,
            createAccountsTx,
            [payer, poolAccount, merkleAccount, nullifierAccount]
        );
        console.log('  Accounts created! Signature:', createSig);
    } catch (err) {
        console.error('  Failed to create accounts:', err.message);
        return;
    }
    console.log('');

    // Step 2: Initialize Pool
    console.log('Step 2: Initializing pool...');

    // Build InitializePool instruction data
    // Format: instruction (1) + token_a_mint (32) + token_b_mint (32) + pool_pubkey (32) + blinding (32) = 129 bytes
    const initData = Buffer.alloc(129);
    initData.writeUInt8(INSTRUCTION.InitializePool, 0);
    SOL_MINT.toBuffer().copy(initData, 1);
    TUSDC_MINT.toBuffer().copy(initData, 33);
    poolAccount.publicKey.toBuffer().copy(initData, 65);
    // Random blinding factor
    const blinding = Keypair.generate().publicKey.toBuffer();
    blinding.copy(initData, 97);

    const initIx = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: poolAccount.publicKey, isSigner: false, isWritable: true },
            { pubkey: merkleAccount.publicKey, isSigner: false, isWritable: true },
            { pubkey: nullifierAccount.publicKey, isSigner: false, isWritable: true },
        ],
        data: initData,
    });

    try {
        const initTx = new Transaction().add(initIx);
        const initSig = await sendAndConfirmTransaction(connection, initTx, [payer]);
        console.log('  Pool initialized! Signature:', initSig);
    } catch (err) {
        console.error('  Failed to initialize pool:', err.message);
        if (err.logs) {
            console.error('  Logs:', err.logs);
        }
        return;
    }
    console.log('');

    // Step 3: Test AddLiquidity
    console.log('Step 3: Testing AddLiquidity...');

    // Build AddLiquidity instruction data
    // Format: instruction (1) + amount_a (8) + amount_b (8) + min_lp (8) = 25 bytes
    const addLiqData = Buffer.alloc(25);
    addLiqData.writeUInt8(INSTRUCTION.AddLiquidity, 0);
    addLiqData.writeBigUInt64LE(BigInt(1e9), 1);  // 1 SOL
    addLiqData.writeBigUInt64LE(BigInt(150e6), 9); // 150 TUSDC
    addLiqData.writeBigUInt64LE(BigInt(0), 17);    // min_lp = 0 (no slippage protection for test)

    // Generate dummy accounts for token vaults (not used in simplified test)
    const tokenAVault = Keypair.generate();
    const tokenBVault = Keypair.generate();
    const lpTokenAccount = Keypair.generate();

    const addLiqIx = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: poolAccount.publicKey, isSigner: false, isWritable: true },
            { pubkey: tokenAVault.publicKey, isSigner: false, isWritable: true },  // token_a_account
            { pubkey: tokenBVault.publicKey, isSigner: false, isWritable: true },  // token_b_account
            { pubkey: lpTokenAccount.publicKey, isSigner: false, isWritable: true }, // lp_token_account
        ],
        data: addLiqData,
    });

    try {
        const addLiqTx = new Transaction().add(addLiqIx);
        const addLiqSig = await sendAndConfirmTransaction(connection, addLiqTx, [payer]);
        console.log('  AddLiquidity successful! Signature:', addLiqSig);
    } catch (err) {
        console.error('  Failed to add liquidity:', err.message);
        if (err.logs) {
            console.error('  Logs:', err.logs);
        }
        return;
    }
    console.log('');

    // Verify pool state after AddLiquidity
    console.log('Step 4: Verifying pool state after AddLiquidity...');
    let poolInfo = await connection.getAccountInfo(poolAccount.publicKey);
    let totalLpAfterAdd = BigInt(0);
    if (poolInfo) {
        console.log('  Pool account size:', poolInfo.data.length);
        console.log('  Pool owner:', poolInfo.owner.toBase58());

        // Parse pool state
        const data = poolInfo.data;
        const isInitialized = data[0] !== 0;
        const reserveA = data.readBigUInt64LE(66);
        const reserveB = data.readBigUInt64LE(74);
        totalLpAfterAdd = data.readBigUInt64LE(82);

        console.log('  Is initialized:', isInitialized);
        console.log('  Reserve A:', Number(reserveA) / 1e9, 'SOL');
        console.log('  Reserve B:', Number(reserveB) / 1e6, 'TUSDC');
        console.log('  Total LP:', Number(totalLpAfterAdd));
    }
    console.log('');

    // Step 5: Test RemoveLiquidity
    console.log('Step 5: Testing RemoveLiquidity...');

    // Remove 50% of LP tokens
    const lpToRemove = totalLpAfterAdd / BigInt(2);
    console.log('  Removing LP:', Number(lpToRemove), '(50% of total)');

    // Build RemoveLiquidity instruction data
    // Format: instruction (1) + lp_amount (8) + min_amount_a (8) + min_amount_b (8) = 25 bytes
    const removeLiqData = Buffer.alloc(25);
    removeLiqData.writeUInt8(INSTRUCTION.RemoveLiquidity, 0);
    removeLiqData.writeBigUInt64LE(lpToRemove, 1);      // lp_amount
    removeLiqData.writeBigUInt64LE(BigInt(0), 9);       // min_amount_a = 0 (no slippage protection for test)
    removeLiqData.writeBigUInt64LE(BigInt(0), 17);      // min_amount_b = 0

    const removeLiqIx = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: poolAccount.publicKey, isSigner: false, isWritable: true },
            { pubkey: tokenAVault.publicKey, isSigner: false, isWritable: true },
            { pubkey: tokenBVault.publicKey, isSigner: false, isWritable: true },
            { pubkey: lpTokenAccount.publicKey, isSigner: false, isWritable: true },
        ],
        data: removeLiqData,
    });

    try {
        const removeLiqTx = new Transaction().add(removeLiqIx);
        const removeLiqSig = await sendAndConfirmTransaction(connection, removeLiqTx, [payer]);
        console.log('  RemoveLiquidity successful! Signature:', removeLiqSig);
    } catch (err) {
        console.error('  Failed to remove liquidity:', err.message);
        if (err.logs) {
            console.error('  Logs:', err.logs);
        }
        return;
    }
    console.log('');

    // Verify pool state after RemoveLiquidity
    console.log('Step 6: Verifying pool state after RemoveLiquidity...');
    poolInfo = await connection.getAccountInfo(poolAccount.publicKey);
    if (poolInfo) {
        const data = poolInfo.data;
        const reserveA = data.readBigUInt64LE(66);
        const reserveB = data.readBigUInt64LE(74);
        const totalLp = data.readBigUInt64LE(82);

        console.log('  Reserve A:', Number(reserveA) / 1e9, 'SOL');
        console.log('  Reserve B:', Number(reserveB) / 1e6, 'TUSDC');
        console.log('  Total LP:', Number(totalLp));
        console.log('  LP reduced by:', Number(totalLpAfterAdd - totalLp), '(expected:', Number(lpToRemove), ')');
    }
    console.log('');

    console.log('='.repeat(60));
    console.log('All Tests Complete!');
    console.log('='.repeat(60));
}

main().catch(console.error);
