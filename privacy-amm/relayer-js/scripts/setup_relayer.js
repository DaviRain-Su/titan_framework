#!/usr/bin/env node
/**
 * Relayer Account Setup Script
 *
 * This script generates a new Ed25519 keypair for the relayer
 * and provides instructions for funding it.
 *
 * Usage:
 *   node scripts/setup_relayer.js
 *   node scripts/setup_relayer.js --testnet  (request airdrop on testnet)
 */

const { Keypair, Connection, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const TESTNET_RPC = 'https://api.testnet.solana.com';
const DEVNET_RPC = 'https://api.devnet.solana.com';

async function main() {
    console.log('===========================================');
    console.log('  Privacy AMM Relayer Account Setup');
    console.log('===========================================\n');

    // Check if keypair already exists
    const keypairPath = path.join(__dirname, '..', 'relayer-keypair.json');
    let keypair;

    if (fs.existsSync(keypairPath)) {
        console.log('Found existing keypair at:', keypairPath);
        const secretKey = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
        keypair = Keypair.fromSecretKey(new Uint8Array(secretKey));
        console.log('Loaded existing keypair.\n');
    } else {
        console.log('Generating new keypair...');
        keypair = Keypair.generate();

        // Save keypair
        fs.writeFileSync(keypairPath, JSON.stringify(Array.from(keypair.secretKey)));
        console.log('Saved keypair to:', keypairPath);
        console.log('\n⚠️  IMPORTANT: Keep this file secure and never commit it to git!\n');
    }

    // Display public key
    console.log('Public Key:', keypair.publicKey.toBase58());
    console.log('');

    // Check balance
    const useTestnet = process.argv.includes('--testnet');
    const useDevnet = process.argv.includes('--devnet');
    const rpcUrl = useTestnet ? TESTNET_RPC : (useDevnet ? DEVNET_RPC : TESTNET_RPC);
    const network = useTestnet ? 'testnet' : (useDevnet ? 'devnet' : 'testnet');

    console.log(`Connecting to ${network}...`);
    const connection = new Connection(rpcUrl, 'confirmed');

    try {
        const balance = await connection.getBalance(keypair.publicKey);
        console.log('Current Balance:', balance / LAMPORTS_PER_SOL, 'SOL');
        console.log('');

        if (balance < 0.1 * LAMPORTS_PER_SOL) {
            console.log('⚠️  Balance is low! The relayer needs SOL to pay for transaction fees.');
            console.log('');

            // Request airdrop on testnet/devnet
            if (useTestnet || useDevnet) {
                console.log('Requesting airdrop...');
                try {
                    const airdropSig = await connection.requestAirdrop(
                        keypair.publicKey,
                        2 * LAMPORTS_PER_SOL
                    );
                    await connection.confirmTransaction(airdropSig);
                    console.log('✅ Airdrop successful!');

                    const newBalance = await connection.getBalance(keypair.publicKey);
                    console.log('New Balance:', newBalance / LAMPORTS_PER_SOL, 'SOL');
                } catch (err) {
                    console.log('❌ Airdrop failed:', err.message);
                    console.log('   Try again later or use a faucet.');
                }
            } else {
                console.log('To fund the relayer on testnet, run:');
                console.log('   node scripts/setup_relayer.js --testnet');
                console.log('');
                console.log('Or use the Solana CLI:');
                console.log(`   solana airdrop 2 ${keypair.publicKey.toBase58()} --url ${rpcUrl}`);
            }
        } else {
            console.log('✅ Relayer account is funded and ready!');
        }
    } catch (err) {
        console.log('Failed to check balance:', err.message);
    }

    // Output environment variable format
    console.log('\n===========================================');
    console.log('  Environment Variables for Cloudflare');
    console.log('===========================================\n');

    console.log('Add these to your Cloudflare Worker secrets:\n');
    console.log('RELAYER_SECRET_KEY=' + JSON.stringify(Array.from(keypair.secretKey)));
    console.log('RELAYER_PUBLIC_KEY=' + keypair.publicKey.toBase58());
    console.log('');

    console.log('Or set via wrangler CLI:');
    console.log(`wrangler secret put RELAYER_SECRET_KEY`);
    console.log('');

    // Output for .env file
    const envContent = `# Relayer Configuration
RELAYER_SECRET_KEY='${JSON.stringify(Array.from(keypair.secretKey))}'
RELAYER_PUBLIC_KEY='${keypair.publicKey.toBase58()}'
SOLANA_RPC_URL='${rpcUrl}'
PROGRAM_ID='GZfqgHqekzR4D8TAq165XB8U2boVdK5ehEEH4n7u4Xts'
`;

    const envPath = path.join(__dirname, '..', '.env.example');
    fs.writeFileSync(envPath, envContent);
    console.log('Created .env.example at:', envPath);
    console.log('Copy to .env and configure for local development.\n');

    console.log('===========================================');
    console.log('  Relayer Setup Complete!');
    console.log('===========================================');
}

main().catch(console.error);
