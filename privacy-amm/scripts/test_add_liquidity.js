/**
 * Privacy AMM AddLiquidity Test
 * Tests complete AddLiquidity with real WSOL and TUSDC transfers
 */

const {
    Connection,
    PublicKey,
    Keypair,
    SystemProgram,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
    LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const {
    TOKEN_PROGRAM_ID,
    createInitializeMintInstruction,
    createInitializeAccountInstruction,
    createSyncNativeInstruction,
    getMinimumBalanceForRentExemptMint,
    getMinimumBalanceForRentExemptAccount,
    MINT_SIZE,
    ACCOUNT_SIZE,
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
    NATIVE_MINT,
} = require('@solana/spl-token');
const fs = require('fs');
const path = require('path');

// Configuration
const PROGRAM_ID = new PublicKey('5XNfzGiTt7WNveJrLRKcz2w9wyCDqLNMYHaQWZJjo8ef');
const RPC_URL = 'https://api.devnet.solana.com';

// Token mints
const TUSDC_MINT = new PublicKey('ESkAKdYXJyUueJ6SNa6p96kDvE2NJPdYbSrnk7F8mcqM');

// Account sizes
const POOL_SIZE = 162;
const MERKLE_SIZE = 1316;
const NULLIFIER_SIZE = 12000;

// Instructions
const INSTRUCTION = {
    InitializePool: 0,
    Deposit: 1,
    Withdraw: 2,
    Swap: 3,
    AddLiquidity: 4,
    RemoveLiquidity: 5,
};

async function main() {
    console.log('='.repeat(60));
    console.log('Privacy AMM AddLiquidity Full Test');
    console.log('='.repeat(60));
    console.log('');

    // Load payer keypair
    const keypairPath = path.join(process.env.HOME, '.config/solana/id.json');
    const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
    const payer = Keypair.fromSecretKey(new Uint8Array(keypairData));

    console.log('Payer:', payer.publicKey.toBase58());
    console.log('Program:', PROGRAM_ID.toBase58());

    // Connect to devnet
    const connection = new Connection(RPC_URL, 'confirmed');
    const balance = await connection.getBalance(payer.publicKey);
    console.log('Balance:', balance / LAMPORTS_PER_SOL, 'SOL');
    console.log('');

    // =========================================================================
    // Step 1: Generate all accounts and derive PDA
    // =========================================================================
    console.log('Step 1: Generating accounts and deriving PDA...');

    const poolAccount = Keypair.generate();
    const lpMint = Keypair.generate();
    const merkleAccount = Keypair.generate();
    const nullifierAccount = Keypair.generate();
    const poolVaultA = Keypair.generate(); // WSOL vault
    const poolVaultB = Keypair.generate(); // TUSDC vault

    // Derive pool authority PDA
    const [poolAuthority, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from('pool_authority'), poolAccount.publicKey.toBuffer()],
        PROGRAM_ID
    );

    console.log('  Pool Account:', poolAccount.publicKey.toBase58());
    console.log('  LP Mint:', lpMint.publicKey.toBase58());
    console.log('  Pool Authority PDA:', poolAuthority.toBase58(), '(bump:', bump, ')');
    console.log('  Pool Vault A (WSOL):', poolVaultA.publicKey.toBase58());
    console.log('  Pool Vault B (TUSDC):', poolVaultB.publicKey.toBase58());
    console.log('');

    // =========================================================================
    // Step 2: Create accounts (split into multiple transactions)
    // =========================================================================
    console.log('Step 2: Creating accounts...');

    const mintRent = await getMinimumBalanceForRentExemptMint(connection);
    const tokenAccountRent = await getMinimumBalanceForRentExemptAccount(connection);
    const poolRent = await connection.getMinimumBalanceForRentExemption(POOL_SIZE);
    const merkleRent = await connection.getMinimumBalanceForRentExemption(MERKLE_SIZE);
    const nullifierRent = await connection.getMinimumBalanceForRentExemption(NULLIFIER_SIZE);

    // Transaction 1: LP Mint + Pool Vaults
    console.log('  Creating LP Mint and Pool Vaults...');
    const tx1 = new Transaction();
    tx1.add(
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: lpMint.publicKey,
            lamports: mintRent,
            space: MINT_SIZE,
            programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(lpMint.publicKey, 6, poolAuthority, null)
    );
    tx1.add(
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: poolVaultA.publicKey,
            lamports: tokenAccountRent,
            space: ACCOUNT_SIZE,
            programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeAccountInstruction(poolVaultA.publicKey, NATIVE_MINT, poolAuthority)
    );
    tx1.add(
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: poolVaultB.publicKey,
            lamports: tokenAccountRent,
            space: ACCOUNT_SIZE,
            programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeAccountInstruction(poolVaultB.publicKey, TUSDC_MINT, poolAuthority)
    );

    try {
        const sig = await sendAndConfirmTransaction(connection, tx1, [payer, lpMint, poolVaultA, poolVaultB]);
        console.log('    Tx1 success:', sig);
    } catch (err) {
        console.error('  Failed:', err.message);
        if (err.logs) console.error('  Logs:', err.logs);
        return;
    }

    // Transaction 2: Pool state accounts
    console.log('  Creating Pool state accounts...');
    const tx2 = new Transaction();
    tx2.add(
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: poolAccount.publicKey,
            lamports: poolRent,
            space: POOL_SIZE,
            programId: PROGRAM_ID,
        }),
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: merkleAccount.publicKey,
            lamports: merkleRent,
            space: MERKLE_SIZE,
            programId: PROGRAM_ID,
        }),
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: nullifierAccount.publicKey,
            lamports: nullifierRent,
            space: NULLIFIER_SIZE,
            programId: PROGRAM_ID,
        })
    );

    try {
        const sig = await sendAndConfirmTransaction(connection, tx2, [payer, poolAccount, merkleAccount, nullifierAccount]);
        console.log('    Tx2 success:', sig);
    } catch (err) {
        console.error('  Failed:', err.message);
        if (err.logs) console.error('  Logs:', err.logs);
        return;
    }
    console.log('');

    // =========================================================================
    // Step 3: Create user token accounts
    // =========================================================================
    console.log('Step 3: Creating user token accounts...');

    // User WSOL account (will create new one and fund it)
    const userWsolAccount = Keypair.generate();
    const wsolAmount = 0.5 * LAMPORTS_PER_SOL; // 0.5 SOL to wrap

    // User TUSDC account (ATA)
    const userTusdcAccount = await getAssociatedTokenAddress(TUSDC_MINT, payer.publicKey);

    // User LP account (ATA)
    const userLpAccount = await getAssociatedTokenAddress(lpMint.publicKey, payer.publicKey);

    console.log('  User WSOL account:', userWsolAccount.publicKey.toBase58());
    console.log('  User TUSDC account:', userTusdcAccount.toBase58());
    console.log('  User LP account:', userLpAccount.toBase58());

    const createUserAccountsTx = new Transaction();

    // Create and fund WSOL account
    createUserAccountsTx.add(
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: userWsolAccount.publicKey,
            lamports: tokenAccountRent + wsolAmount, // Rent + amount to wrap
            space: ACCOUNT_SIZE,
            programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeAccountInstruction(
            userWsolAccount.publicKey,
            NATIVE_MINT,
            payer.publicKey,
        ),
        createSyncNativeInstruction(userWsolAccount.publicKey)
    );

    // Create user LP account (ATA)
    createUserAccountsTx.add(
        createAssociatedTokenAccountInstruction(
            payer.publicKey,
            userLpAccount,
            payer.publicKey,
            lpMint.publicKey,
        )
    );

    try {
        const sig = await sendAndConfirmTransaction(
            connection,
            createUserAccountsTx,
            [payer, userWsolAccount]
        );
        console.log('  User accounts created! Signature:', sig);
    } catch (err) {
        console.error('  Failed to create user accounts:', err.message);
        if (err.logs) console.error('  Logs:', err.logs);
        return;
    }

    // Check user WSOL balance
    const wsolInfo = await connection.getTokenAccountBalance(userWsolAccount.publicKey);
    console.log('  User WSOL balance:', wsolInfo.value.uiAmount, 'SOL');

    // Check user TUSDC balance
    try {
        const tusdcInfo = await connection.getTokenAccountBalance(userTusdcAccount);
        console.log('  User TUSDC balance:', tusdcInfo.value.uiAmount, 'TUSDC');
    } catch (err) {
        console.log('  User TUSDC account not found. Please fund with TUSDC first.');
        return;
    }
    console.log('');

    // =========================================================================
    // Step 4: Initialize pool
    // =========================================================================
    console.log('Step 4: Initializing pool...');

    // Initialize data: instruction(1) + token_a(32) + token_b(32) + pool_pubkey(32) + blinding(32) + bump(1) = 130 bytes
    const initData = Buffer.alloc(130);
    initData.writeUInt8(INSTRUCTION.InitializePool, 0);
    NATIVE_MINT.toBuffer().copy(initData, 1);
    TUSDC_MINT.toBuffer().copy(initData, 33);
    poolAccount.publicKey.toBuffer().copy(initData, 65);
    Keypair.generate().publicKey.toBuffer().copy(initData, 97); // blinding
    initData.writeUInt8(bump, 129); // Store the PDA bump
    console.log('  Storing bump in pool state:', bump);

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
        const sig = await sendAndConfirmTransaction(
            connection,
            new Transaction().add(initIx),
            [payer]
        );
        console.log('  Pool initialized! Signature:', sig);
    } catch (err) {
        console.error('  Failed to initialize pool:', err.message);
        if (err.logs) console.error('  Logs:', err.logs);
        return;
    }
    console.log('');

    // =========================================================================
    // Step 5: AddLiquidity
    // =========================================================================
    console.log('Step 5: Adding liquidity...');

    const amountA = BigInt(0.1 * LAMPORTS_PER_SOL); // 0.1 SOL
    const amountB = BigInt(15 * 1e6); // 15 TUSDC (6 decimals)
    const minLp = BigInt(0); // No slippage protection for test

    console.log('  Amount A (WSOL):', Number(amountA) / LAMPORTS_PER_SOL, 'SOL');
    console.log('  Amount B (TUSDC):', Number(amountB) / 1e6, 'TUSDC');

    // Build AddLiquidity instruction
    // Format: instruction(1) + amount_a(8) + amount_b(8) + min_lp(8) = 25 bytes
    const addLiqData = Buffer.alloc(25);
    addLiqData.writeUInt8(INSTRUCTION.AddLiquidity, 0);
    addLiqData.writeBigUInt64LE(amountA, 1);
    addLiqData.writeBigUInt64LE(amountB, 9);
    addLiqData.writeBigUInt64LE(minLp, 17);

    // Account layout for AddLiquidity:
    // [0] provider: LP provider (signer)
    // [1] pool_account: Pool state
    // [2] user_token_a: User's token A account
    // [3] user_token_b: User's token B account
    // [4] pool_vault_a: Pool's token A vault
    // [5] pool_vault_b: Pool's token B vault
    // [6] lp_mint: LP token mint
    // [7] user_lp_account: User's LP token account
    // [8] pool_authority: PDA authority for the pool
    // [9] token_program: SPL Token program

    const addLiqIx = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: poolAccount.publicKey, isSigner: false, isWritable: true },
            { pubkey: userWsolAccount.publicKey, isSigner: false, isWritable: true },
            { pubkey: userTusdcAccount, isSigner: false, isWritable: true },
            { pubkey: poolVaultA.publicKey, isSigner: false, isWritable: true },
            { pubkey: poolVaultB.publicKey, isSigner: false, isWritable: true },
            { pubkey: lpMint.publicKey, isSigner: false, isWritable: true },
            { pubkey: userLpAccount, isSigner: false, isWritable: true },
            { pubkey: poolAuthority, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: addLiqData,
    });

    try {
        const sig = await sendAndConfirmTransaction(
            connection,
            new Transaction().add(addLiqIx),
            [payer]
        );
        console.log('  AddLiquidity successful! Signature:', sig);
    } catch (err) {
        console.error('  Failed to add liquidity:', err.message);
        if (err.logs) console.error('  Logs:', err.logs);
        return;
    }
    console.log('');

    // =========================================================================
    // Step 6: Verify state
    // =========================================================================
    console.log('Step 6: Verifying state after AddLiquidity...');

    // Pool state
    const poolInfo = await connection.getAccountInfo(poolAccount.publicKey);
    if (poolInfo) {
        const data = poolInfo.data;
        const reserveA = data.readBigUInt64LE(66);
        const reserveB = data.readBigUInt64LE(74);
        const totalLp = data.readBigUInt64LE(82);

        console.log('  Pool Reserve A:', Number(reserveA) / LAMPORTS_PER_SOL, 'SOL');
        console.log('  Pool Reserve B:', Number(reserveB) / 1e6, 'TUSDC');
        console.log('  Pool Total LP:', Number(totalLp));
    }

    // Vault balances
    const vaultAInfo = await connection.getTokenAccountBalance(poolVaultA.publicKey);
    const vaultBInfo = await connection.getTokenAccountBalance(poolVaultB.publicKey);
    console.log('  Vault A balance:', vaultAInfo.value.uiAmount, 'SOL');
    console.log('  Vault B balance:', vaultBInfo.value.uiAmount, 'TUSDC');

    // User LP balance
    const userLpInfo = await connection.getTokenAccountBalance(userLpAccount);
    console.log('  User LP balance:', userLpInfo.value.uiAmount);
    console.log('');

    // =========================================================================
    // Step 7: RemoveLiquidity
    // =========================================================================
    console.log('Step 7: Removing liquidity (50%)...');

    const lpToRemove = BigInt(userLpInfo.value.amount) / BigInt(2);
    console.log('  LP to remove:', Number(lpToRemove));

    // Build RemoveLiquidity instruction
    const removeLiqData = Buffer.alloc(25);
    removeLiqData.writeUInt8(INSTRUCTION.RemoveLiquidity, 0);
    removeLiqData.writeBigUInt64LE(lpToRemove, 1);
    removeLiqData.writeBigUInt64LE(BigInt(0), 9);  // min_amount_a
    removeLiqData.writeBigUInt64LE(BigInt(0), 17); // min_amount_b

    const removeLiqIx = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: poolAccount.publicKey, isSigner: false, isWritable: true },
            { pubkey: userWsolAccount.publicKey, isSigner: false, isWritable: true },
            { pubkey: userTusdcAccount, isSigner: false, isWritable: true },
            { pubkey: poolVaultA.publicKey, isSigner: false, isWritable: true },
            { pubkey: poolVaultB.publicKey, isSigner: false, isWritable: true },
            { pubkey: lpMint.publicKey, isSigner: false, isWritable: true },
            { pubkey: userLpAccount, isSigner: false, isWritable: true },
            { pubkey: poolAuthority, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: removeLiqData,
    });

    try {
        const sig = await sendAndConfirmTransaction(
            connection,
            new Transaction().add(removeLiqIx),
            [payer]
        );
        console.log('  RemoveLiquidity successful! Signature:', sig);
    } catch (err) {
        console.error('  Failed to remove liquidity:', err.message);
        if (err.logs) console.error('  Logs:', err.logs);
        return;
    }
    console.log('');

    // =========================================================================
    // Step 8: Final state
    // =========================================================================
    console.log('Step 8: Final state after RemoveLiquidity...');

    // Pool state
    const finalPoolInfo = await connection.getAccountInfo(poolAccount.publicKey);
    if (finalPoolInfo) {
        const data = finalPoolInfo.data;
        const reserveA = data.readBigUInt64LE(66);
        const reserveB = data.readBigUInt64LE(74);
        const totalLp = data.readBigUInt64LE(82);

        console.log('  Pool Reserve A:', Number(reserveA) / LAMPORTS_PER_SOL, 'SOL');
        console.log('  Pool Reserve B:', Number(reserveB) / 1e6, 'TUSDC');
        console.log('  Pool Total LP:', Number(totalLp));
    }

    // User LP balance
    const finalLpInfo = await connection.getTokenAccountBalance(userLpAccount);
    console.log('  User LP balance:', finalLpInfo.value.uiAmount);
    console.log('');

    console.log('='.repeat(60));
    console.log('All Tests Complete!');
    console.log('='.repeat(60));
}

main().catch(console.error);
