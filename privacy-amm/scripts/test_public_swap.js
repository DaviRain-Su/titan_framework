/**
 * Privacy AMM Public Swap Test
 * Tests the constant product swap formula on testnet
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
const {
    TOKEN_PROGRAM_ID,
    createInitializeMintInstruction,
    createInitializeAccountInstruction,
    createMintToInstruction,
    getMinimumBalanceForRentExemptMint,
    getMinimumBalanceForRentExemptAccount,
    MINT_SIZE,
    ACCOUNT_SIZE,
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
    createSyncNativeInstruction,
    NATIVE_MINT,
} = require('@solana/spl-token');
const fs = require('fs');
const path = require('path');

// Configuration
const PROGRAM_ID = new PublicKey('5XNfzGiTt7WNveJrLRKcz2w9wyCDqLNMYHaQWZJjo8ef');
const RPC_URL = 'https://api.testnet.solana.com';

// Token mints
const TUSDC_MINT = new PublicKey('ESkAKdYXJyUueJ6SNa6p96kDvE2NJPdYbSrnk7F8mcqM');
const WSOL_MINT = NATIVE_MINT;

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
    PublicSwap: 6,
};

async function main() {
    console.log('='.repeat(60));
    console.log('Privacy AMM Public Swap Test');
    console.log('='.repeat(60));
    console.log('');

    // Load payer keypair
    const keypairPath = path.join(process.env.HOME, '.config/solana/id.json');
    const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
    const payer = Keypair.fromSecretKey(new Uint8Array(keypairData));

    console.log('Payer:', payer.publicKey.toBase58());
    console.log('Program:', PROGRAM_ID.toBase58());
    console.log('');

    // Connect to testnet
    const connection = new Connection(RPC_URL, 'confirmed');
    const balance = await connection.getBalance(payer.publicKey);
    console.log('Balance:', balance / 1e9, 'SOL');
    console.log('');

    // =========================================================================
    // Step 1: Setup - Create pool and add initial liquidity
    // =========================================================================
    console.log('Step 1: Setting up pool with initial liquidity...');

    // Generate accounts
    const poolAccount = Keypair.generate();
    const merkleAccount = Keypair.generate();
    const nullifierAccount = Keypair.generate();
    const lpMint = Keypair.generate();
    const poolVaultA = Keypair.generate(); // WSOL vault
    const poolVaultB = Keypair.generate(); // TUSDC vault

    // Derive PDA
    const [poolAuthority, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from('pool_authority'), poolAccount.publicKey.toBuffer()],
        PROGRAM_ID
    );
    console.log('  Pool Account:', poolAccount.publicKey.toBase58());
    console.log('  Pool Authority PDA:', poolAuthority.toBase58());
    console.log('  Bump:', bump);

    // Get rent exemptions
    const mintRent = await getMinimumBalanceForRentExemptMint(connection);
    const tokenAccountRent = await getMinimumBalanceForRentExemptAccount(connection);
    const poolRent = await connection.getMinimumBalanceForRentExemption(POOL_SIZE);
    const merkleRent = await connection.getMinimumBalanceForRentExemption(MERKLE_SIZE);
    const nullifierRent = await connection.getMinimumBalanceForRentExemption(NULLIFIER_SIZE);

    // Transaction 1: Create LP Mint
    console.log('  Creating LP Mint...');
    const tx1 = new Transaction().add(
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: lpMint.publicKey,
            lamports: mintRent,
            space: MINT_SIZE,
            programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
            lpMint.publicKey,
            6,
            poolAuthority,
            null,
        )
    );
    await sendAndConfirmTransaction(connection, tx1, [payer, lpMint]);

    // Transaction 2: Create pool vaults and user accounts
    console.log('  Creating token accounts...');
    const userLpAccount = await getAssociatedTokenAddress(lpMint.publicKey, payer.publicKey);
    const userWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, payer.publicKey);
    const userTusdcAccount = await getAssociatedTokenAddress(TUSDC_MINT, payer.publicKey);

    const tx2 = new Transaction();

    // Pool vaults
    tx2.add(
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: poolVaultA.publicKey,
            lamports: tokenAccountRent,
            space: ACCOUNT_SIZE,
            programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeAccountInstruction(poolVaultA.publicKey, WSOL_MINT, poolAuthority)
    );
    tx2.add(
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: poolVaultB.publicKey,
            lamports: tokenAccountRent,
            space: ACCOUNT_SIZE,
            programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeAccountInstruction(poolVaultB.publicKey, TUSDC_MINT, poolAuthority)
    );

    // User LP account
    tx2.add(createAssociatedTokenAccountInstruction(payer.publicKey, userLpAccount, payer.publicKey, lpMint.publicKey));

    await sendAndConfirmTransaction(connection, tx2, [payer, poolVaultA, poolVaultB]);

    // Transaction 3: Create pool state accounts
    console.log('  Creating pool state accounts...');
    const tx3 = new Transaction();
    tx3.add(
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
    await sendAndConfirmTransaction(connection, tx3, [payer, poolAccount, merkleAccount, nullifierAccount]);

    // Transaction 4: Initialize pool
    console.log('  Initializing pool...');
    const initData = Buffer.alloc(130);
    initData.writeUInt8(INSTRUCTION.InitializePool, 0);
    WSOL_MINT.toBuffer().copy(initData, 1);
    TUSDC_MINT.toBuffer().copy(initData, 33);
    poolAccount.publicKey.toBuffer().copy(initData, 65);
    Keypair.generate().publicKey.toBuffer().copy(initData, 97); // blinding
    initData.writeUInt8(bump, 129);

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
    await sendAndConfirmTransaction(connection, new Transaction().add(initIx), [payer]);

    // Transaction 5: Wrap SOL for user
    console.log('  Wrapping SOL...');
    const wrapAmount = 0.2 * 1e9; // 0.2 SOL

    // Check if WSOL account exists
    const wsolAccountInfo = await connection.getAccountInfo(userWsolAccount);
    if (!wsolAccountInfo) {
        console.log('  Creating WSOL account...');
        const createWsolTx = new Transaction().add(
            createAssociatedTokenAccountInstruction(payer.publicKey, userWsolAccount, payer.publicKey, WSOL_MINT)
        );
        await sendAndConfirmTransaction(connection, createWsolTx, [payer]);
    }

    // Now wrap SOL
    const wrapTx = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: userWsolAccount,
            lamports: wrapAmount,
        }),
        createSyncNativeInstruction(userWsolAccount)
    );
    await sendAndConfirmTransaction(connection, wrapTx, [payer]);

    // Transaction 6: Add initial liquidity
    console.log('  Adding initial liquidity (0.1 SOL + 15 TUSDC)...');
    const addLiqData = Buffer.alloc(25);
    addLiqData.writeUInt8(INSTRUCTION.AddLiquidity, 0);
    addLiqData.writeBigUInt64LE(BigInt(0.1 * 1e9), 1);  // 0.1 SOL
    addLiqData.writeBigUInt64LE(BigInt(15 * 1e6), 9);   // 15 TUSDC
    addLiqData.writeBigUInt64LE(BigInt(0), 17);         // min_lp = 0

    const addLiqIx = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: poolAccount.publicKey, isSigner: false, isWritable: true },
            { pubkey: userWsolAccount, isSigner: false, isWritable: true },
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
    await sendAndConfirmTransaction(connection, new Transaction().add(addLiqIx), [payer]);

    console.log('  Initial liquidity added!');
    console.log('');

    // =========================================================================
    // Step 2: Check pool state before swap
    // =========================================================================
    console.log('Step 2: Checking pool state before swap...');

    const poolData = (await connection.getAccountInfo(poolAccount.publicKey)).data;
    const reserveA_before = poolData.readBigUInt64LE(66);  // offset: 1+1+32+32 = 66
    const reserveB_before = poolData.readBigUInt64LE(74);  // offset: 66+8 = 74
    const totalLp = poolData.readBigUInt64LE(82);          // offset: 74+8 = 82

    console.log('  Reserve A (WSOL):', Number(reserveA_before) / 1e9, 'SOL');
    console.log('  Reserve B (TUSDC):', Number(reserveB_before) / 1e6, 'TUSDC');
    console.log('  Total LP:', Number(totalLp));
    console.log('  k =', Number(reserveA_before) * Number(reserveB_before));
    console.log('');

    // =========================================================================
    // Step 3: Execute Public Swap (WSOL → TUSDC)
    // =========================================================================
    console.log('Step 3: Executing Public Swap (0.01 SOL → TUSDC)...');

    const swapAmountIn = BigInt(0.01 * 1e9); // 0.01 SOL
    const minAmountOut = BigInt(0);          // Accept any output for test
    const direction = 0;                      // A → B (WSOL → TUSDC)

    // Calculate expected output
    // dy = (y * dx * 997) / (x * 1000 + dx * 997)
    const dx = swapAmountIn;
    const x = reserveA_before;
    const y = reserveB_before;
    const expectedOut = (y * dx * BigInt(997)) / (x * BigInt(1000) + dx * BigInt(997));
    console.log('  Input:', Number(dx) / 1e9, 'SOL');
    console.log('  Expected output:', Number(expectedOut) / 1e6, 'TUSDC');

    const swapData = Buffer.alloc(18);
    swapData.writeUInt8(INSTRUCTION.PublicSwap, 0);
    swapData.writeBigUInt64LE(swapAmountIn, 1);
    swapData.writeBigUInt64LE(minAmountOut, 9);
    swapData.writeUInt8(direction, 17);

    const swapIx = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: poolAccount.publicKey, isSigner: false, isWritable: true },
            { pubkey: userWsolAccount, isSigner: false, isWritable: true },    // user_token_in
            { pubkey: userTusdcAccount, isSigner: false, isWritable: true },   // user_token_out
            { pubkey: poolVaultA.publicKey, isSigner: false, isWritable: true }, // pool_vault_in
            { pubkey: poolVaultB.publicKey, isSigner: false, isWritable: true }, // pool_vault_out
            { pubkey: poolAuthority, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: swapData,
    });

    try {
        const swapSig = await sendAndConfirmTransaction(connection, new Transaction().add(swapIx), [payer]);
        console.log('  Swap successful! Signature:', swapSig);
    } catch (err) {
        console.error('  Swap failed:', err.message);
        if (err.logs) {
            console.error('  Logs:', err.logs);
        }
        return;
    }
    console.log('');

    // =========================================================================
    // Step 4: Check pool state after swap
    // =========================================================================
    console.log('Step 4: Checking pool state after swap...');

    const poolDataAfter = (await connection.getAccountInfo(poolAccount.publicKey)).data;
    const reserveA_after = poolDataAfter.readBigUInt64LE(66);
    const reserveB_after = poolDataAfter.readBigUInt64LE(74);

    console.log('  Reserve A (WSOL):', Number(reserveA_after) / 1e9, 'SOL');
    console.log('  Reserve B (TUSDC):', Number(reserveB_after) / 1e6, 'TUSDC');
    console.log('  k =', Number(reserveA_after) * Number(reserveB_after));
    console.log('');

    // Verify k increased (due to fees)
    const k_before = Number(reserveA_before) * Number(reserveB_before);
    const k_after = Number(reserveA_after) * Number(reserveB_after);
    console.log('  k before:', k_before);
    console.log('  k after:', k_after);
    console.log('  k increased:', k_after >= k_before ? 'YES (0.3% fee collected)' : 'NO (ERROR!)');
    console.log('');

    // Check actual output
    const actualOut = Number(reserveB_before - reserveB_after);
    console.log('  Actual output:', actualOut / 1e6, 'TUSDC');
    console.log('  Expected output:', Number(expectedOut) / 1e6, 'TUSDC');
    console.log('  Match:', actualOut === Number(expectedOut) ? 'YES' : 'Close enough');

    console.log('');
    console.log('='.repeat(60));
    console.log('Public Swap Test Complete!');
    console.log('='.repeat(60));
}

main().catch(console.error);
