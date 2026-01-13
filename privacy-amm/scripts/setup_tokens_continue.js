/**
 * Continue Setup SPL Tokens for Privacy AMM
 * Uses existing mints from previous run that was interrupted
 */

const {
    Connection,
    PublicKey,
    Keypair,
    Transaction,
    sendAndConfirmTransaction,
    SystemProgram,
    LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const {
    createMintToInstruction,
    createAssociatedTokenAccountInstruction,
    getAssociatedTokenAddress,
    createSyncNativeInstruction,
    getAccount,
    TOKEN_PROGRAM_ID,
    NATIVE_MINT,
} = require('@solana/spl-token');
const fs = require('fs');
const path = require('path');

// Program ID
const PROGRAM_ID = new PublicKey('GZfqgHqekzR4D8TAq165XB8U2boVdK5ehEEH4n7u4Xts');

// Pool account (new pool with correct bump)
const POOL_ACCOUNT = new PublicKey('4K65JKhxhUtDarHarbKXLnk6Uq8XN6ocnqfPTTmweQ1D');

// From previous run that succeeded:
const tUSDC_MINT = new PublicKey('3fZgymugtSbiW6eQgnVkGRwPeJxueXrSHPgMhBRWkFN6');
const LP_MINT = new PublicKey('5jx6pL7uGSfZqiG94Bh6b94M1yNt7YwLS1AWcQQ2i3XB');
const POOL_WSOL_VAULT = new PublicKey('HNgkrsnGRZRPStxuv8LuDWaxQFQfGA9TpjvLHPavW7k8');
const POOL_USDC_VAULT = new PublicKey('6wpex9bRe3Gw2yeAYpXSFfjZPLVyVpWYhGoqJnDzuhWJ');

const WSOL_MINT = NATIVE_MINT; // So11111111111111111111111111111111111111112
const WSOL_DECIMALS = 9;
const tUSDC_DECIMALS = 6;
const LP_DECIMALS = 9;

async function main() {
    console.log('='.repeat(60));
    console.log('Continue Setup SPL Tokens for Privacy AMM');
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
    console.log('Balance:', balance / LAMPORTS_PER_SOL, 'SOL');
    console.log('');

    // Find pool authority PDA
    const [poolAuthority, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from('pool_authority'), POOL_ACCOUNT.toBuffer()],
        PROGRAM_ID
    );
    console.log('Pool Authority PDA:', poolAuthority.toBase58());
    console.log('Bump:', bump);
    console.log('');

    console.log('Using existing mints from previous run:');
    console.log('  tUSDC:', tUSDC_MINT.toBase58());
    console.log('  LP:', LP_MINT.toBase58());
    console.log('  Pool wSOL vault:', POOL_WSOL_VAULT.toBase58());
    console.log('  Pool tUSDC vault:', POOL_USDC_VAULT.toBase58());
    console.log('');

    // ========================================
    // Step 4: Create User Token Accounts
    // ========================================
    console.log('Step 4: Creating user token accounts...');

    const userWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, payer.publicKey);
    const userUsdcAccount = await getAssociatedTokenAddress(tUSDC_MINT, payer.publicKey);
    const userLpAccount = await getAssociatedTokenAddress(LP_MINT, payer.publicKey);

    // Check which accounts need to be created
    const createUserAccountsTx = new Transaction();

    // Check wSOL account
    try {
        await getAccount(connection, userWsolAccount);
        console.log('✅ User wSOL account exists:', userWsolAccount.toBase58());
    } catch (e) {
        createUserAccountsTx.add(
            createAssociatedTokenAccountInstruction(
                payer.publicKey,
                userWsolAccount,
                payer.publicKey,
                WSOL_MINT,
            )
        );
        console.log('Creating wSOL account...');
    }

    // Check tUSDC account
    try {
        await getAccount(connection, userUsdcAccount);
        console.log('✅ User tUSDC account exists:', userUsdcAccount.toBase58());
    } catch (e) {
        createUserAccountsTx.add(
            createAssociatedTokenAccountInstruction(
                payer.publicKey,
                userUsdcAccount,
                payer.publicKey,
                tUSDC_MINT,
            )
        );
        console.log('Creating tUSDC account...');
    }

    // Check LP account
    try {
        await getAccount(connection, userLpAccount);
        console.log('✅ User LP account exists:', userLpAccount.toBase58());
    } catch (e) {
        createUserAccountsTx.add(
            createAssociatedTokenAccountInstruction(
                payer.publicKey,
                userLpAccount,
                payer.publicKey,
                LP_MINT,
            )
        );
        console.log('Creating LP account...');
    }

    if (createUserAccountsTx.instructions.length > 0) {
        await sendAndConfirmTransaction(connection, createUserAccountsTx, [payer]);
    }
    console.log('✅ User wSOL account:', userWsolAccount.toBase58());
    console.log('✅ User tUSDC account:', userUsdcAccount.toBase58());
    console.log('✅ User LP account:', userLpAccount.toBase58());

    // ========================================
    // Step 5: Wrap SOL into wSOL and Mint tUSDC
    // ========================================
    console.log('');
    console.log('Step 5: Wrapping SOL and minting tUSDC...');

    const wsolAmount = 0.5 * LAMPORTS_PER_SOL; // 0.5 SOL (for testing)
    const usdcAmount = 100n * 10n ** BigInt(tUSDC_DECIMALS); // 100 tUSDC (for testing)

    // Transfer SOL to wSOL account and sync
    const wrapAndMintTx = new Transaction().add(
        // Transfer SOL to wSOL account
        SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: userWsolAccount,
            lamports: wsolAmount,
        }),
        // Sync native to update wSOL balance
        createSyncNativeInstruction(userWsolAccount),
        // Mint tUSDC to user
        createMintToInstruction(
            tUSDC_MINT,
            userUsdcAccount,
            payer.publicKey,
            usdcAmount
        )
    );

    await sendAndConfirmTransaction(connection, wrapAndMintTx, [payer]);
    console.log('✅ Wrapped', wsolAmount / LAMPORTS_PER_SOL, 'SOL into wSOL');
    console.log('✅ Minted', Number(usdcAmount) / 10 ** tUSDC_DECIMALS, 'tUSDC');

    // ========================================
    // Save Token Info
    // ========================================
    const tokenInfo = {
        programId: PROGRAM_ID.toBase58(),
        poolAccount: POOL_ACCOUNT.toBase58(),
        poolAuthority: poolAuthority.toBase58(),
        poolAuthorityBump: bump,
        tokenA: {
            mint: WSOL_MINT.toBase58(),
            decimals: WSOL_DECIMALS,
            symbol: 'wSOL',
            name: 'Wrapped SOL',
            isNative: true,
        },
        tokenB: {
            mint: tUSDC_MINT.toBase58(),
            decimals: tUSDC_DECIMALS,
            symbol: 'tUSDC',
            name: 'Test USDC',
        },
        lpToken: {
            mint: LP_MINT.toBase58(),
            decimals: LP_DECIMALS,
            symbol: 'wSOL-tUSDC-LP',
        },
        poolVaults: {
            wsolVault: POOL_WSOL_VAULT.toBase58(),
            usdcVault: POOL_USDC_VAULT.toBase58(),
        },
        userAccounts: {
            wsol: userWsolAccount.toBase58(),
            usdc: userUsdcAccount.toBase58(),
            lp: userLpAccount.toBase58(),
        },
    };

    const tokenInfoPath = path.join(__dirname, '../circuits/build/token_accounts.json');
    fs.writeFileSync(tokenInfoPath, JSON.stringify(tokenInfo, null, 2));
    console.log('');
    console.log('Token info saved to:', tokenInfoPath);

    console.log('');
    console.log('='.repeat(60));
    console.log('✅ Token Setup Complete!');
    console.log('='.repeat(60));
    console.log('');
    console.log('Summary:');
    console.log('  Token A: wSOL (Native SOL wrapped)');
    console.log('  Token B: tUSDC', tUSDC_MINT.toBase58());
    console.log('  LP Token:', LP_MINT.toBase58());
    console.log('');
    console.log('User balances:');
    console.log('  wSOL:', wsolAmount / LAMPORTS_PER_SOL);
    console.log('  tUSDC:', Number(usdcAmount) / 10 ** tUSDC_DECIMALS);
    console.log('');
    console.log('Next steps:');
    console.log('  1. Run: node scripts/add_liquidity_spl.js');
    console.log('  2. Then: node scripts/public_swap_spl.js');
}

main().catch(console.error);
