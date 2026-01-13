/**
 * Add Initial Liquidity to Privacy AMM Pool
 * 向隐私 AMM 池添加初始流动性
 */

const {
    Connection,
    PublicKey,
    Keypair,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
} = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

// Program ID
const PROGRAM_ID = new PublicKey('GZfqgHqekzR4D8TAq165XB8U2boVdK5ehEEH4n7u4Xts');

// Pool accounts (from circuits/build/pool_accounts.json)
const POOL_ACCOUNTS = {
    poolAccount: new PublicKey('3Lz9gKbA1kB4V4bu4cGVpXrvStpUs48iBKX56ksw6Wbt'),
    merkleAccount: new PublicKey('DNNEL3RqN2kNYdGn65VgLHiMoUEoi49mms15nsYFVwgQ'),
    nullifierAccount: new PublicKey('Hh6pbngRGfnQ7T5casM4eobwQyJe1LDSRjAA9EVx2rtE'),
};

// Instruction ID
const ADD_LIQUIDITY_INSTRUCTION = 4;

async function main() {
    console.log('='.repeat(60));
    console.log('Add Liquidity to Privacy AMM Pool');
    console.log('='.repeat(60));
    console.log('');

    // Parse command line args
    const args = process.argv.slice(2);
    let amountA = 10 * 1e9;   // Default: 10 SOL (in lamports)
    let amountB = 1500 * 1e6; // Default: 1500 USDC (in smallest unit)

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--sol' && args[i + 1]) {
            amountA = parseFloat(args[i + 1]) * 1e9;
        }
        if (args[i] === '--usdc' && args[i + 1]) {
            amountB = parseFloat(args[i + 1]) * 1e6;
        }
    }

    console.log('Adding liquidity:');
    console.log('  SOL:', amountA / 1e9);
    console.log('  USDC:', amountB / 1e6);
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

    // Build AddLiquidity instruction data
    // Layout: [instruction_id: u8, amount_a: u64, amount_b: u64, min_lp: u64]
    const instructionData = Buffer.alloc(25);
    let offset = 0;

    // Instruction ID
    instructionData.writeUInt8(ADD_LIQUIDITY_INSTRUCTION, offset);
    offset += 1;

    // Amount A (little-endian)
    instructionData.writeBigUInt64LE(BigInt(Math.floor(amountA)), offset);
    offset += 8;

    // Amount B (little-endian)
    instructionData.writeBigUInt64LE(BigInt(Math.floor(amountB)), offset);
    offset += 8;

    // Min LP (0 = no slippage protection for initial liquidity)
    instructionData.writeBigUInt64LE(BigInt(0), offset);

    console.log('Instruction data:', instructionData.toString('hex'));
    console.log('');

    // Create instruction
    const addLiquidityInstruction = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: false },
            { pubkey: POOL_ACCOUNTS.poolAccount, isSigner: false, isWritable: true },
        ],
        data: instructionData,
    });

    // Create and send transaction
    const transaction = new Transaction().add(addLiquidityInstruction);

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
        console.error('❌ Failed to add liquidity:', err.message);
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
    const poolAccountInfo = await connection.getAccountInfo(POOL_ACCOUNTS.poolAccount);
    if (poolAccountInfo) {
        const data = poolAccountInfo.data;

        // Parse pool state
        const isInitialized = data[0] !== 0;
        const reserveA = data.readBigUInt64LE(66);  // offset: 1 + 1 + 32 + 32 = 66
        const reserveB = data.readBigUInt64LE(74);  // offset: 66 + 8 = 74
        const totalLp = data.readBigUInt64LE(82);   // offset: 74 + 8 = 82

        console.log('Pool State:');
        console.log('  Initialized:', isInitialized);
        console.log('  Reserve A (SOL):', Number(reserveA) / 1e9);
        console.log('  Reserve B (USDC):', Number(reserveB) / 1e6);
        console.log('  Total LP:', Number(totalLp));
    }

    console.log('');
    console.log('='.repeat(60));
    console.log('Done!');
    console.log('='.repeat(60));
}

main().catch(console.error);
