/**
 * Add Liquidity to Privacy AMM Pool (with real SPL Tokens)
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
const ADD_LIQUIDITY_INSTRUCTION = 4;

async function main() {
    console.log('='.repeat(60));
    console.log('Add Liquidity to Privacy AMM Pool');
    console.log('='.repeat(60));
    console.log('');

    // Parse args
    const args = process.argv.slice(2);
    let amountA = 1 * LAMPORTS_PER_SOL;  // 1 wSOL
    let amountB = 150 * 1e6;              // 150 tUSDC

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--sol' && args[i + 1]) {
            amountA = parseFloat(args[i + 1]) * LAMPORTS_PER_SOL;
        }
        if (args[i] === '--usdc' && args[i + 1]) {
            amountB = parseFloat(args[i + 1]) * 1e6;
        }
    }

    console.log('Adding liquidity:');
    console.log('  wSOL:', amountA / LAMPORTS_PER_SOL);
    console.log('  tUSDC:', amountB / 1e6);
    console.log('');

    // Connect
    const connection = new Connection('https://api.testnet.solana.com', 'confirmed');
    console.log('Connected to testnet');

    // Load keypair
    const keypairPath = path.join(process.env.HOME, '.config/solana/id.json');
    const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
    const payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    console.log('Payer:', payer.publicKey.toBase58());

    // Check balances
    const balance = await connection.getBalance(payer.publicKey);
    console.log('SOL Balance:', balance / LAMPORTS_PER_SOL);

    // Build instruction data
    // Layout: [instruction_id: u8, amount_a: u64, amount_b: u64, min_lp: u64]
    const instructionData = Buffer.alloc(25);
    let offset = 0;

    instructionData.writeUInt8(ADD_LIQUIDITY_INSTRUCTION, offset);
    offset += 1;

    instructionData.writeBigUInt64LE(BigInt(Math.floor(amountA)), offset);
    offset += 8;

    instructionData.writeBigUInt64LE(BigInt(Math.floor(amountB)), offset);
    offset += 8;

    instructionData.writeBigUInt64LE(BigInt(0), offset); // min_lp = 0

    console.log('');
    console.log('Instruction data:', instructionData.toString('hex'));

    // Build accounts list
    // [0] provider: LP provider (signer)
    // [1] pool_account: Pool state
    // [2] user_token_a: User's wSOL account
    // [3] user_token_b: User's tUSDC account
    // [4] pool_vault_a: Pool's wSOL vault
    // [5] pool_vault_b: Pool's tUSDC vault
    // [6] lp_mint: LP token mint
    // [7] user_lp_account: User's LP token account
    // [8] pool_authority: PDA authority
    // [9] token_program: SPL Token program

    const accounts = [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: new PublicKey(tokenAccounts.poolAccount), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(tokenAccounts.userAccounts.wsol), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(tokenAccounts.userAccounts.usdc), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(tokenAccounts.poolVaults.wsolVault), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(tokenAccounts.poolVaults.usdcVault), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(tokenAccounts.lpToken.mint), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(tokenAccounts.userAccounts.lp), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(tokenAccounts.poolAuthority), isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ];

    console.log('');
    console.log('Accounts:');
    accounts.forEach((acc, i) => {
        console.log(`  [${i}]`, acc.pubkey.toBase58().slice(0, 10) + '...');
    });

    const instruction = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: accounts,
        data: instructionData,
    });

    const transaction = new Transaction().add(instruction);

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
        console.log('✅ Liquidity added successfully!');
        console.log('Signature:', signature);
        console.log('Explorer:', `https://explorer.solana.com/tx/${signature}?cluster=testnet`);

    } catch (err) {
        console.error('❌ Failed:', err.message);
        if (err.logs) {
            console.log('');
            console.log('Program logs:');
            err.logs.forEach(log => console.log('  ', log));
        }
        return;
    }

    // Verify pool state
    console.log('');
    console.log('Verifying pool state...');
    const poolInfo = await connection.getAccountInfo(new PublicKey(tokenAccounts.poolAccount));
    if (poolInfo) {
        const data = poolInfo.data;
        const reserveA = data.readBigUInt64LE(66);
        const reserveB = data.readBigUInt64LE(74);
        const totalLp = data.readBigUInt64LE(82);

        console.log('Pool State:');
        console.log('  Reserve A (wSOL):', Number(reserveA) / LAMPORTS_PER_SOL);
        console.log('  Reserve B (tUSDC):', Number(reserveB) / 1e6);
        console.log('  Total LP:', Number(totalLp));
    }

    console.log('');
    console.log('Done!');
}

main().catch(console.error);
