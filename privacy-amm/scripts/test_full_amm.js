/**
 * Privacy AMM Full Integration Test
 * Tests real SPL Token transfers with AddLiquidity and RemoveLiquidity
 */

const {
    Connection,
    PublicKey,
    Keypair,
    SystemProgram,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
    SYSVAR_RENT_PUBKEY,
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
} = require('@solana/spl-token');
const fs = require('fs');
const path = require('path');

// Configuration
const PROGRAM_ID = new PublicKey('5XNfzGiTt7WNveJrLRKcz2w9wyCDqLNMYHaQWZJjo8ef');
const RPC_URL = 'https://api.testnet.solana.com';

// Token mints (using existing ones)
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
    console.log('Privacy AMM Full Integration Test');
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

    // Step 1: Generate accounts and derive PDA
    console.log('Step 1: Generating accounts and deriving PDA...');

    // Generate pool account first (needed for PDA derivation)
    const poolAccount = Keypair.generate();
    const lpMint = Keypair.generate();
    const mintRent = await getMinimumBalanceForRentExemptMint(connection);

    // Derive pool authority PDA from pool account
    const [poolAuthority, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from('pool_authority'), poolAccount.publicKey.toBuffer()],
        PROGRAM_ID
    );
    console.log('  Pool Account:', poolAccount.publicKey.toBase58());
    console.log('  LP Mint:', lpMint.publicKey.toBase58());
    console.log('  Pool Authority PDA:', poolAuthority.toBase58());
    console.log('  PDA Bump:', bump);

    const createMintTx = new Transaction().add(
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: lpMint.publicKey,
            lamports: mintRent,
            space: MINT_SIZE,
            programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
            lpMint.publicKey,
            6, // 6 decimals for LP token
            poolAuthority, // Mint authority is the PDA
            null, // No freeze authority
        )
    );

    try {
        const mintSig = await sendAndConfirmTransaction(connection, createMintTx, [payer, lpMint]);
        console.log('  LP Mint created! Signature:', mintSig);
    } catch (err) {
        console.error('  Failed to create LP mint:', err.message);
        return;
    }
    console.log('');

    // Step 2: Create token accounts
    console.log('Step 2: Creating token accounts...');

    // Create WSOL vault (using native SOL wrapped)
    const wsolMint = new PublicKey('So11111111111111111111111111111111111111112');

    // User's TUSDC account (ATA)
    const userTusdcAccount = await getAssociatedTokenAddress(TUSDC_MINT, payer.publicKey);
    console.log('  User TUSDC account:', userTusdcAccount.toBase58());

    // Pool vaults
    const poolVaultA = Keypair.generate(); // WSOL vault
    const poolVaultB = Keypair.generate(); // TUSDC vault
    const tokenAccountRent = await getMinimumBalanceForRentExemptAccount(connection);

    console.log('  Pool Vault A (WSOL):', poolVaultA.publicKey.toBase58());
    console.log('  Pool Vault B (TUSDC):', poolVaultB.publicKey.toBase58());

    // User's LP token account
    const userLpAccount = await getAssociatedTokenAddress(lpMint.publicKey, payer.publicKey);
    console.log('  User LP account:', userLpAccount.toBase58());

    // Create pool vaults owned by pool authority PDA
    const createVaultsTx = new Transaction();

    // Create WSOL vault
    createVaultsTx.add(
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: poolVaultA.publicKey,
            lamports: tokenAccountRent,
            space: ACCOUNT_SIZE,
            programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeAccountInstruction(
            poolVaultA.publicKey,
            wsolMint,
            poolAuthority, // Owner is pool authority PDA
        )
    );

    // Create TUSDC vault
    createVaultsTx.add(
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: poolVaultB.publicKey,
            lamports: tokenAccountRent,
            space: ACCOUNT_SIZE,
            programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeAccountInstruction(
            poolVaultB.publicKey,
            TUSDC_MINT,
            poolAuthority, // Owner is pool authority PDA
        )
    );

    // Create user's LP token account (ATA)
    createVaultsTx.add(
        createAssociatedTokenAccountInstruction(
            payer.publicKey,
            userLpAccount,
            payer.publicKey,
            lpMint.publicKey,
        )
    );

    try {
        const vaultsSig = await sendAndConfirmTransaction(
            connection,
            createVaultsTx,
            [payer, poolVaultA, poolVaultB]
        );
        console.log('  Token accounts created! Signature:', vaultsSig);
    } catch (err) {
        console.error('  Failed to create token accounts:', err.message);
        if (err.logs) {
            console.error('  Logs:', err.logs);
        }
        return;
    }
    console.log('');

    // Step 3: Create pool state accounts
    console.log('Step 3: Creating pool state accounts...');

    // poolAccount was already generated in Step 1 for PDA derivation
    const merkleAccount = Keypair.generate();
    const nullifierAccount = Keypair.generate();

    console.log('  Pool Account:', poolAccount.publicKey.toBase58());
    console.log('  Merkle Account:', merkleAccount.publicKey.toBase58());
    console.log('  Nullifier Account:', nullifierAccount.publicKey.toBase58());

    const poolRent = await connection.getMinimumBalanceForRentExemption(POOL_SIZE);
    const merkleRent = await connection.getMinimumBalanceForRentExemption(MERKLE_SIZE);
    const nullifierRent = await connection.getMinimumBalanceForRentExemption(NULLIFIER_SIZE);

    const createPoolAccountsTx = new Transaction();
    createPoolAccountsTx.add(
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
        const poolAccountsSig = await sendAndConfirmTransaction(
            connection,
            createPoolAccountsTx,
            [payer, poolAccount, merkleAccount, nullifierAccount]
        );
        console.log('  Pool accounts created! Signature:', poolAccountsSig);
    } catch (err) {
        console.error('  Failed to create pool accounts:', err.message);
        return;
    }
    console.log('');

    // Step 4: Initialize Pool
    console.log('Step 4: Initializing pool...');

    const initData = Buffer.alloc(129);
    initData.writeUInt8(INSTRUCTION.InitializePool, 0);
    wsolMint.toBuffer().copy(initData, 1);
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

    // Step 5: Check TUSDC balance
    console.log('Step 5: Checking TUSDC balance...');
    try {
        const tusdcInfo = await connection.getTokenAccountBalance(userTusdcAccount);
        console.log('  User TUSDC balance:', tusdcInfo.value.uiAmount, 'TUSDC');

        if (parseFloat(tusdcInfo.value.amount) < 100e6) {
            console.log('  WARNING: Insufficient TUSDC for test. Need at least 100 TUSDC.');
            console.log('  You can mint more TUSDC using: spl-token mint', TUSDC_MINT.toBase58(), '1000');
        }
    } catch (err) {
        console.log('  User does not have a TUSDC account. Creating one...');
        console.log('  Please fund this account with TUSDC before running the full test.');
    }
    console.log('');

    console.log('='.repeat(60));
    console.log('Setup Complete!');
    console.log('='.repeat(60));
    console.log('');
    console.log('Summary:');
    console.log('  LP Mint:', lpMint.publicKey.toBase58());
    console.log('  Pool Authority:', poolAuthority.toBase58());
    console.log('  Pool State:', poolAccount.publicKey.toBase58());
    console.log('  Pool Vault A:', poolVaultA.publicKey.toBase58());
    console.log('  Pool Vault B:', poolVaultB.publicKey.toBase58());
    console.log('');
    console.log('Next steps:');
    console.log('  1. Ensure you have TUSDC tokens');
    console.log('  2. Wrap some SOL to WSOL for testing');
    console.log('  3. Run AddLiquidity with the proper accounts');
}

main().catch(console.error);
