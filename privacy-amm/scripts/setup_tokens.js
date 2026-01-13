/**
 * Setup SPL Tokens for Privacy AMM
 * 使用 wSOL (原生 SOL 包装) + tUSDC (测试代币)
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
    createInitializeMintInstruction,
    createMintToInstruction,
    createAssociatedTokenAccountInstruction,
    getAssociatedTokenAddress,
    createSyncNativeInstruction,
    TOKEN_PROGRAM_ID,
    NATIVE_MINT,
    MINT_SIZE,
    getMinimumBalanceForRentExemptMint,
} = require('@solana/spl-token');
const fs = require('fs');
const path = require('path');

// Program ID
const PROGRAM_ID = new PublicKey('GZfqgHqekzR4D8TAq165XB8U2boVdK5ehEEH4n7u4Xts');

// Pool account
const POOL_ACCOUNT = new PublicKey('3Lz9gKbA1kB4V4bu4cGVpXrvStpUs48iBKX56ksw6Wbt');

// wSOL 是原生 SOL 的 SPL Token 包装
const WSOL_MINT = NATIVE_MINT; // So11111111111111111111111111111111111111112
const WSOL_DECIMALS = 9;

async function main() {
    console.log('='.repeat(60));
    console.log('Setup SPL Tokens for Privacy AMM');
    console.log('wSOL (Native SOL) + tUSDC (Test Token)');
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

    if (balance < 1 * LAMPORTS_PER_SOL) {
        console.log('Need at least 1 SOL. Run: solana airdrop 2 --url testnet');
        return;
    }

    // Find pool authority PDA
    const [poolAuthority, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from('pool_authority'), POOL_ACCOUNT.toBuffer()],
        PROGRAM_ID
    );
    console.log('Pool Authority PDA:', poolAuthority.toBase58());
    console.log('Bump:', bump);
    console.log('');

    // ========================================
    // Step 1: Create tUSDC mint (test USDC)
    // ========================================
    console.log('Step 1: Creating tUSDC mint...');
    const tUsdcMint = Keypair.generate();
    const tUsdcDecimals = 6;

    const createUsdcMintTx = new Transaction().add(
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: tUsdcMint.publicKey,
            lamports: await getMinimumBalanceForRentExemptMint(connection),
            space: MINT_SIZE,
            programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
            tUsdcMint.publicKey,
            tUsdcDecimals,
            payer.publicKey,  // Mint authority
            null,             // No freeze authority
        )
    );

    await sendAndConfirmTransaction(connection, createUsdcMintTx, [payer, tUsdcMint]);
    console.log('✅ tUSDC mint created:', tUsdcMint.publicKey.toBase58());

    // ========================================
    // Step 2: Create LP Token mint
    // ========================================
    console.log('');
    console.log('Step 2: Creating LP Token mint...');
    const lpMint = Keypair.generate();
    const lpDecimals = 9;

    const createLpMintTx = new Transaction().add(
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: lpMint.publicKey,
            lamports: await getMinimumBalanceForRentExemptMint(connection),
            space: MINT_SIZE,
            programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMintInstruction(
            lpMint.publicKey,
            lpDecimals,
            poolAuthority,  // Pool authority can mint LP tokens
            null,
        )
    );

    await sendAndConfirmTransaction(connection, createLpMintTx, [payer, lpMint]);
    console.log('✅ LP mint created:', lpMint.publicKey.toBase58());

    // ========================================
    // Step 3: Create Pool Token Vaults (ATAs)
    // ========================================
    console.log('');
    console.log('Step 3: Creating pool token vaults...');

    const poolVaultWsol = await getAssociatedTokenAddress(WSOL_MINT, poolAuthority, true);
    const poolVaultUsdc = await getAssociatedTokenAddress(tUsdcMint.publicKey, poolAuthority, true);

    const createVaultsTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
            payer.publicKey,
            poolVaultWsol,
            poolAuthority,
            WSOL_MINT,
        ),
        createAssociatedTokenAccountInstruction(
            payer.publicKey,
            poolVaultUsdc,
            poolAuthority,
            tUsdcMint.publicKey,
        )
    );

    await sendAndConfirmTransaction(connection, createVaultsTx, [payer]);
    console.log('✅ Pool wSOL vault:', poolVaultWsol.toBase58());
    console.log('✅ Pool tUSDC vault:', poolVaultUsdc.toBase58());

    // ========================================
    // Step 4: Create User Token Accounts
    // ========================================
    console.log('');
    console.log('Step 4: Creating user token accounts...');

    const userWsolAccount = await getAssociatedTokenAddress(WSOL_MINT, payer.publicKey);
    const userUsdcAccount = await getAssociatedTokenAddress(tUsdcMint.publicKey, payer.publicKey);
    const userLpAccount = await getAssociatedTokenAddress(lpMint.publicKey, payer.publicKey);

    const createUserAccountsTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(
            payer.publicKey,
            userWsolAccount,
            payer.publicKey,
            WSOL_MINT,
        ),
        createAssociatedTokenAccountInstruction(
            payer.publicKey,
            userUsdcAccount,
            payer.publicKey,
            tUsdcMint.publicKey,
        ),
        createAssociatedTokenAccountInstruction(
            payer.publicKey,
            userLpAccount,
            payer.publicKey,
            lpMint.publicKey,
        )
    );

    await sendAndConfirmTransaction(connection, createUserAccountsTx, [payer]);
    console.log('✅ User wSOL account:', userWsolAccount.toBase58());
    console.log('✅ User tUSDC account:', userUsdcAccount.toBase58());
    console.log('✅ User LP account:', userLpAccount.toBase58());

    // ========================================
    // Step 5: Wrap SOL into wSOL and Mint tUSDC
    // ========================================
    console.log('');
    console.log('Step 5: Wrapping SOL and minting tUSDC...');

    const wsolAmount = 2 * LAMPORTS_PER_SOL; // 2 SOL (for testing)
    const usdcAmount = 300n * 10n ** BigInt(tUsdcDecimals); // 300 tUSDC (for testing)

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
            tUsdcMint.publicKey,
            userUsdcAccount,
            payer.publicKey,
            usdcAmount
        )
    );

    await sendAndConfirmTransaction(connection, wrapAndMintTx, [payer]);
    console.log('✅ Wrapped', wsolAmount / LAMPORTS_PER_SOL, 'SOL into wSOL');
    console.log('✅ Minted', Number(usdcAmount) / 10 ** tUsdcDecimals, 'tUSDC');

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
            mint: tUsdcMint.publicKey.toBase58(),
            decimals: tUsdcDecimals,
            symbol: 'tUSDC',
            name: 'Test USDC',
        },
        lpToken: {
            mint: lpMint.publicKey.toBase58(),
            decimals: lpDecimals,
            symbol: 'wSOL-tUSDC-LP',
        },
        poolVaults: {
            wsolVault: poolVaultWsol.toBase58(),
            usdcVault: poolVaultUsdc.toBase58(),
        },
        userAccounts: {
            wsol: userWsolAccount.toBase58(),
            usdc: userUsdcAccount.toBase58(),
            lp: userLpAccount.toBase58(),
        },
        mintSecretKeys: {
            tUsdc: Array.from(tUsdcMint.secretKey),
            lp: Array.from(lpMint.secretKey),
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
    console.log('  Token B: tUSDC', tUsdcMint.publicKey.toBase58());
    console.log('  LP Token:', lpMint.publicKey.toBase58());
    console.log('');
    console.log('User balances:');
    console.log('  wSOL:', wsolAmount / LAMPORTS_PER_SOL);
    console.log('  tUSDC:', Number(usdcAmount) / 10 ** tUsdcDecimals);
    console.log('');
    console.log('Next steps:');
    console.log('  1. Run: node scripts/add_liquidity_spl.js');
    console.log('  2. Then: node scripts/public_swap_spl.js');
}

main().catch(console.error);
