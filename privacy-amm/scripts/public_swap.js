/**
 * Public Swap on Privacy AMM Pool
 * 公开交换测试 (不需要 ZK 证明)
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

// Pool accounts
const POOL_ACCOUNTS = {
    poolAccount: new PublicKey('3Lz9gKbA1kB4V4bu4cGVpXrvStpUs48iBKX56ksw6Wbt'),
    merkleAccount: new PublicKey('DNNEL3RqN2kNYdGn65VgLHiMoUEoi49mms15nsYFVwgQ'),
    nullifierAccount: new PublicKey('Hh6pbngRGfnQ7T5casM4eobwQyJe1LDSRjAA9EVx2rtE'),
};

// Instruction ID
const PUBLIC_SWAP_INSTRUCTION = 6;

async function main() {
    console.log('='.repeat(60));
    console.log('Public Swap on Privacy AMM Pool');
    console.log('='.repeat(60));
    console.log('');

    // Parse command line args
    const args = process.argv.slice(2);
    let amountIn = 0.1 * 1e9;  // Default: 0.1 SOL
    let direction = 0;          // 0 = SOL->USDC, 1 = USDC->SOL
    let minOut = 0;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--amount' && args[i + 1]) {
            amountIn = parseFloat(args[i + 1]);
            // Auto-detect direction based on size
            if (amountIn > 100) {
                // Probably USDC (small decimals)
                amountIn = amountIn * 1e6;
                direction = 1;
            } else {
                amountIn = amountIn * 1e9;
                direction = 0;
            }
        }
        if (args[i] === '--sol') {
            direction = 0;
            if (args[i + 1] && !args[i + 1].startsWith('--')) {
                amountIn = parseFloat(args[i + 1]) * 1e9;
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

    const dirStr = direction === 0 ? 'SOL → USDC' : 'USDC → SOL';
    console.log('Swap direction:', dirStr);
    console.log('Amount in:', direction === 0 ? amountIn / 1e9 + ' SOL' : amountIn / 1e6 + ' USDC');
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
    const poolAccountInfo = await connection.getAccountInfo(POOL_ACCOUNTS.poolAccount);
    if (poolAccountInfo) {
        const data = poolAccountInfo.data;
        const reserveA = data.readBigUInt64LE(66);
        const reserveB = data.readBigUInt64LE(74);
        const totalLp = data.readBigUInt64LE(82);

        console.log('  Reserve A (SOL):', Number(reserveA) / 1e9);
        console.log('  Reserve B (USDC):', Number(reserveB) / 1e6);
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
            ? Number(expectedOut) / 1e6 + ' USDC'
            : Number(expectedOut) / 1e9 + ' SOL');
    }

    // Build PublicSwap instruction data
    // Layout: [instruction_id: u8, amount_in: u64, min_amount_out: u64, direction: u8]
    const instructionData = Buffer.alloc(18);
    let offset = 0;

    // Instruction ID
    instructionData.writeUInt8(PUBLIC_SWAP_INSTRUCTION, offset);
    offset += 1;

    // Amount in (little-endian)
    instructionData.writeBigUInt64LE(BigInt(Math.floor(amountIn)), offset);
    offset += 8;

    // Min amount out (little-endian)
    instructionData.writeBigUInt64LE(BigInt(Math.floor(minOut)), offset);
    offset += 8;

    // Direction
    instructionData.writeUInt8(direction, offset);

    console.log('');
    console.log('Instruction data:', instructionData.toString('hex'));

    // Create instruction
    const swapInstruction = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: false },
            { pubkey: POOL_ACCOUNTS.poolAccount, isSigner: false, isWritable: true },
        ],
        data: instructionData,
    });

    // Create and send transaction
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
    const newPoolInfo = await connection.getAccountInfo(POOL_ACCOUNTS.poolAccount);
    if (newPoolInfo) {
        const data = newPoolInfo.data;
        const reserveA = data.readBigUInt64LE(66);
        const reserveB = data.readBigUInt64LE(74);

        console.log('  Reserve A (SOL):', Number(reserveA) / 1e9);
        console.log('  Reserve B (USDC):', Number(reserveB) / 1e6);
    }

    console.log('');
    console.log('='.repeat(60));
    console.log('Done!');
    console.log('='.repeat(60));
}

main().catch(console.error);
