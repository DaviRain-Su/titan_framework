/**
 * Public Swap on Privacy AMM Pool (with SPL Tokens)
 */

const {
    Connection,
    PublicKey,
    Keypair,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
    LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const fs = require('fs');
const path = require('path');

// Load token accounts
const tokenAccounts = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../circuits/build/token_accounts.json'), 'utf8')
);

const PROGRAM_ID = new PublicKey(tokenAccounts.programId);
const PUBLIC_SWAP_INSTRUCTION = 6;

async function main() {
    console.log('='.repeat(60));
    console.log('Public Swap on Privacy AMM Pool (SPL Tokens)');
    console.log('='.repeat(60));
    console.log('');

    // Parse command line args
    const args = process.argv.slice(2);
    let amountIn = 0.1 * LAMPORTS_PER_SOL;  // Default: 0.1 SOL
    let direction = 0;          // 0 = SOL->USDC, 1 = USDC->SOL
    let minOut = 0;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--sol') {
            direction = 0;
            if (args[i + 1] && !args[i + 1].startsWith('--')) {
                amountIn = parseFloat(args[i + 1]) * LAMPORTS_PER_SOL;
            }
        }
        if (args[i] === '--usdc') {
            direction = 1;
            if (args[i + 1] && !args[i + 1].startsWith('--')) {
                amountIn = parseFloat(args[i + 1]) * 1e6;
            }
        }
        if (args[i] === '--min' && args[i + 1]) {
            minOut = parseFloat(args[i + 1]);
        }
    }

    const dirStr = direction === 0 ? 'wSOL → tUSDC' : 'tUSDC → wSOL';
    console.log('Swap direction:', dirStr);
    console.log('Amount in:', direction === 0 ? amountIn / LAMPORTS_PER_SOL + ' wSOL' : amountIn / 1e6 + ' tUSDC');
    console.log('Min out:', minOut);
    console.log('');

    // Connect to testnet
    const connection = new Connection('https://api.testnet.solana.com', 'confirmed');
    console.log('Connected to testnet');

    // Load keypair
    const keypairPath = path.join(process.env.HOME, '.config/solana/id.json');
    const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
    const payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    console.log('Payer:', payer.publicKey.toBase58());

    // Get current pool state
    console.log('');
    console.log('Current pool state:');
    const poolAccountInfo = await connection.getAccountInfo(new PublicKey(tokenAccounts.poolAccount));
    if (poolAccountInfo) {
        const data = poolAccountInfo.data;
        const reserveA = data.readBigUInt64LE(66);
        const reserveB = data.readBigUInt64LE(74);
        const totalLp = data.readBigUInt64LE(82);

        console.log('  Reserve A (wSOL):', Number(reserveA) / LAMPORTS_PER_SOL);
        console.log('  Reserve B (tUSDC):', Number(reserveB) / 1e6);
        console.log('  Total LP:', Number(totalLp));

        // Calculate expected output
        const resIn = direction === 0 ? reserveA : reserveB;
        const resOut = direction === 0 ? reserveB : reserveA;

        const amountInWithFee = BigInt(Math.floor(amountIn)) * 997n;
        const numerator = resOut * amountInWithFee;
        const denominator = resIn * 1000n + amountInWithFee;
        const expectedOut = numerator / denominator;

        console.log('');
        console.log('Expected output:', direction === 0
            ? Number(expectedOut) / 1e6 + ' tUSDC'
            : Number(expectedOut) / LAMPORTS_PER_SOL + ' wSOL');
    }

    // Build PublicSwap instruction data
    // Layout: [instruction_id: u8, amount_in: u64, min_amount_out: u64, direction: u8]
    const instructionData = Buffer.alloc(18);
    let offset = 0;

    instructionData.writeUInt8(PUBLIC_SWAP_INSTRUCTION, offset);
    offset += 1;

    instructionData.writeBigUInt64LE(BigInt(Math.floor(amountIn)), offset);
    offset += 8;

    instructionData.writeBigUInt64LE(BigInt(Math.floor(minOut)), offset);
    offset += 8;

    instructionData.writeUInt8(direction, offset);

    console.log('');
    console.log('Instruction data:', instructionData.toString('hex'));

    // Build accounts list based on direction
    // [0] swapper: User performing the swap (signer)
    // [1] pool_account: Pool state
    // [2] user_token_in: User's input token account
    // [3] user_token_out: User's output token account
    // [4] pool_vault_in: Pool's input token vault
    // [5] pool_vault_out: Pool's output token vault
    // [6] pool_authority: PDA authority for the pool
    // [7] token_program: SPL Token program

    let userTokenIn, userTokenOut, poolVaultIn, poolVaultOut;

    if (direction === 0) {
        // SOL -> USDC
        userTokenIn = new PublicKey(tokenAccounts.userAccounts.wsol);
        userTokenOut = new PublicKey(tokenAccounts.userAccounts.usdc);
        poolVaultIn = new PublicKey(tokenAccounts.poolVaults.wsolVault);
        poolVaultOut = new PublicKey(tokenAccounts.poolVaults.usdcVault);
    } else {
        // USDC -> SOL
        userTokenIn = new PublicKey(tokenAccounts.userAccounts.usdc);
        userTokenOut = new PublicKey(tokenAccounts.userAccounts.wsol);
        poolVaultIn = new PublicKey(tokenAccounts.poolVaults.usdcVault);
        poolVaultOut = new PublicKey(tokenAccounts.poolVaults.wsolVault);
    }

    const accounts = [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: new PublicKey(tokenAccounts.poolAccount), isSigner: false, isWritable: true },
        { pubkey: userTokenIn, isSigner: false, isWritable: true },
        { pubkey: userTokenOut, isSigner: false, isWritable: true },
        { pubkey: poolVaultIn, isSigner: false, isWritable: true },
        { pubkey: poolVaultOut, isSigner: false, isWritable: true },
        { pubkey: new PublicKey(tokenAccounts.poolAuthority), isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ];

    console.log('');
    console.log('Accounts:');
    accounts.forEach((acc, i) => {
        console.log(`  [${i}]`, acc.pubkey.toBase58().slice(0, 10) + '...');
    });

    const swapInstruction = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: accounts,
        data: instructionData,
    });

    const transaction = new Transaction().add(swapInstruction);

    console.log('');
    console.log('Sending transaction...');
    try {
        const signature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [payer],
            { commitment: 'confirmed' }
        );

        console.log('');
        console.log('✅ Swap successful!');
        console.log('Signature:', signature);
        console.log('Explorer:', `https://explorer.solana.com/tx/${signature}?cluster=testnet`);
    } catch (err) {
        console.error('❌ Swap failed:', err.message);
        if (err.logs) {
            console.log('');
            console.log('Program logs:');
            err.logs.forEach(log => console.log('  ', log));
        }
        return;
    }

    // Verify new pool state
    console.log('');
    console.log('New pool state:');
    const newPoolInfo = await connection.getAccountInfo(new PublicKey(tokenAccounts.poolAccount));
    if (newPoolInfo) {
        const data = newPoolInfo.data;
        const reserveA = data.readBigUInt64LE(66);
        const reserveB = data.readBigUInt64LE(74);

        console.log('  Reserve A (wSOL):', Number(reserveA) / LAMPORTS_PER_SOL);
        console.log('  Reserve B (tUSDC):', Number(reserveB) / 1e6);
    }

    console.log('');
    console.log('='.repeat(60));
    console.log('Done!');
    console.log('='.repeat(60));
}

main().catch(console.error);
