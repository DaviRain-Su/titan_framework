/**
 * Privacy AMM Frontend
 * Main application logic with real ZK proof integration
 */

// Polyfill Buffer for browser (required by snarkjs/circomlibjs)
import { Buffer } from 'buffer';
window.Buffer = Buffer;

import {
    initPoseidon,
    computeCommitment,
    computeNullifier,
    derivePublicKey,
    randomFieldElement,
    deriveBlinding,
    scanForUtxo,
    scanForUtxoWithAmounts,
    generateSwapProof,
    generateAddLiquidityProof,
    generateRemoveLiquidityProof,
    formatProofForSolana,
    formatPublicSignalsForSolana,
} from './zkProver.js';

import {
    createMerkleTree,
    syncMerkleTreeFromChain,
    watchMerkleTreeUpdates,
} from './merkleTree.js';

import {
    createUTXOStorage,
    getDepositNonce,
    incrementDepositNonce,
    resetDepositNonce,
} from './utxoStorage.js';

// Configuration
const CONFIG = {
    relayerUrl: 'https://privacy-amm-relayer-staging.davirain-yin.workers.dev',
    rpcUrl: 'https://api.testnet.solana.com',
    wsUrl: 'wss://api.testnet.solana.com',
    network: 'testnet',
    programId: 'GZfqgHqekzR4D8TAq165XB8U2boVdK5ehEEH4n7u4Xts',
    poolAccounts: {
        poolAccount: '4K65JKhxhUtDarHarbKXLnk6Uq8XN6ocnqfPTTmweQ1D',
        merkleAccount: 'FhmBWQcLxFAFqRUvGPzUeZ6N8gSEk7eqc2LQbJidbBfr',
        nullifierAccount: 'jeXXRuP24GSd43E6kjTa1yct6P65XwbjvjNxQ99AymY',
        poolAuthority: 'DEuAfZux9RonRvB3bP4BL6xeE576y54dLFuAQEoTub55',
    },
    // SPL Token accounts for public swaps
    tokenAccounts: {
        wsolMint: 'So11111111111111111111111111111111111111112',
        usdcMint: '3fZgymugtSbiW6eQgnVkGRwPeJxueXrSHPgMhBRWkFN6',
        lpMint: '5jx6pL7uGSfZqiG94Bh6b94M1yNt7YwLS1AWcQQ2i3XB',
        poolWsolVault: 'HNgkrsnGRZRPStxuv8LuDWaxQFQfGA9TpjvLHPavW7k8',
        poolUsdcVault: '6wpex9bRe3Gw2yeAYpXSFfjZPLVyVpWYhGoqJnDzuhWJ',
    },
};

// Asset IDs
const ASSET_SOL = 0;
const ASSET_USDC = 1;
const ASSET_LP = 2;

// State
const state = {
    wallet: null,
    publicKey: null,
    privateKey: null, // User's ZK private key (derived from wallet signature)
    zkPubkey: null,   // User's ZK public key
    utxoStorage: null,
    merkleTree: null,
    poolState: null,
    initialized: false,
};

// ============================================================================
// Initialization
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('Privacy AMM initializing...');

    // Initialize Poseidon hash function
    await initPoseidon();
    console.log('Poseidon initialized');

    // Initialize UI
    initTabs();
    initWallet();
    initSwap();
    initPublicSwap();
    initLiquidity();
    initPortfolio();
    initModals();

    // Load pool state
    await loadPoolState();

    // Initialize Merkle tree
    state.merkleTree = await createMerkleTree();
    console.log('Merkle tree initialized');

    // Try to sync from chain
    try {
        state.merkleTree = await syncMerkleTreeFromChain(
            CONFIG.rpcUrl,
            CONFIG.poolAccounts.merkleAccount
        );
        console.log('Merkle tree synced from chain');
    } catch (err) {
        console.warn('Failed to sync Merkle tree:', err);
    }

    state.initialized = true;
    console.log('Privacy AMM ready');
});

// ============================================================================
// Tab Navigation
// ============================================================================

function initTabs() {
    const navLinks = document.querySelectorAll('.nav-link');

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const tab = link.dataset.tab;

            // Update nav
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            // Update content
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            document.getElementById(`${tab}-tab`).classList.add('active');
        });
    });
}

// ============================================================================
// Wallet Connection
// ============================================================================

function initWallet() {
    const connectBtn = document.getElementById('connect-wallet');
    const disconnectBtn = document.getElementById('disconnect-wallet');

    connectBtn.addEventListener('click', connectWallet);
    disconnectBtn.addEventListener('click', disconnectWallet);

    // Check if already connected
    checkWalletConnection();
}

async function connectWallet() {
    try {
        // Check for Solana wallet (Phantom, Backpack, or other)
        const wallet = window.backpack?.solana || window.solana;

        if (!wallet) {
            alert('Please install a Solana wallet (Phantom, Backpack, etc.) to use this app.');
            return;
        }

        const response = await wallet.connect();
        state.publicKey = response.publicKey.toString();
        state.wallet = wallet;

        // Initialize encrypted UTXO storage
        state.utxoStorage = createUTXOStorage();
        const encryptionEnabled = await state.utxoStorage.init(state.wallet, state.publicKey);

        if (encryptionEnabled) {
            console.log('UTXO storage initialized with encryption');
        } else {
            console.log('UTXO storage initialized without encryption');
        }

        // Derive ZK keypair from wallet signature
        await deriveZkKeypair();

        updateWalletUI(true);
        updateButtonStates(true);
        updatePortfolio();

        // Fetch SPL Token balances for public swap
        await fetchTokenBalances();

        console.log('Connected:', state.publicKey);

    } catch (err) {
        console.error('Wallet connection failed:', err);
        alert('Failed to connect wallet: ' + err.message);
    }
}

async function deriveZkKeypair() {
    const storageKey = `privacy-amm-zk-keypair-${state.publicKey}`;

    // First, try to load existing keypair from localStorage
    const savedKeypair = localStorage.getItem(storageKey);
    if (savedKeypair) {
        try {
            const parsed = JSON.parse(savedKeypair);
            state.privateKey = parsed.privateKey;
            state.zkPubkey = parsed.zkPubkey;
            console.log('ZK keypair loaded from localStorage');
            return;
        } catch (parseErr) {
            console.error('Failed to parse saved keypair:', parseErr);
        }
    }

    // Try to derive from wallet signature
    try {
        // Sign a deterministic message to derive ZK private key
        const message = `Privacy AMM ZK Keypair\nPublic Key: ${state.publicKey}\nNetwork: ${CONFIG.network}`;
        const encodedMessage = new TextEncoder().encode(message);

        // Try different signMessage patterns for wallet compatibility
        let signature;
        try {
            signature = await state.wallet.signMessage(encodedMessage, 'utf8');
        } catch (e1) {
            // Try without encoding parameter
            signature = await state.wallet.signMessage(encodedMessage);
        }

        // Use first 31 bytes of signature as private key (to stay in field)
        const sigBytes = signature.signature || signature;
        const keyBytes = Array.isArray(sigBytes) ? sigBytes.slice(0, 31) : Array.from(new Uint8Array(sigBytes)).slice(0, 31);

        let privateKeyNum = BigInt(0);
        for (let i = 0; i < 31; i++) {
            privateKeyNum = privateKeyNum * 256n + BigInt(keyBytes[i]);
        }
        state.privateKey = privateKeyNum.toString();

        // Derive public key
        state.zkPubkey = await derivePublicKey(state.privateKey);

        // Save to localStorage for future sessions
        localStorage.setItem(storageKey, JSON.stringify({
            privateKey: state.privateKey,
            zkPubkey: state.zkPubkey,
        }));

        console.log('ZK keypair derived from wallet signature and saved');
    } catch (err) {
        console.error('Failed to derive ZK keypair from signature:', err);

        // Generate new random keypair (first time only)
        state.privateKey = randomFieldElement();
        state.zkPubkey = await derivePublicKey(state.privateKey);

        // Save to localStorage so it persists
        localStorage.setItem(storageKey, JSON.stringify({
            privateKey: state.privateKey,
            zkPubkey: state.zkPubkey,
        }));

        console.log('Generated new ZK keypair and saved to localStorage');
        console.log('WARNING: This keypair is random. Future sessions will use the same keypair from localStorage.');
    }
}

function disconnectWallet() {
    if (state.wallet) {
        state.wallet.disconnect();
    }
    state.wallet = null;
    state.publicKey = null;
    state.privateKey = null;
    state.zkPubkey = null;
    state.utxoStorage = null;

    updateWalletUI(false);
    updateButtonStates(false);
}

function checkWalletConnection() {
    const wallet = window.backpack?.solana || window.solana;

    if (wallet && wallet.isConnected) {
        state.wallet = wallet;
        state.publicKey = wallet.publicKey?.toString();

        if (state.publicKey) {
            // Re-initialize on page refresh
            connectWallet();
        }
    }
}

function updateWalletUI(connected) {
    const connectBtn = document.getElementById('connect-wallet');
    const walletInfo = document.getElementById('wallet-info');
    const addressSpan = document.getElementById('wallet-address');

    if (connected) {
        connectBtn.classList.add('hidden');
        walletInfo.classList.remove('hidden');
        addressSpan.textContent = shortenAddress(state.publicKey);
    } else {
        connectBtn.classList.remove('hidden');
        walletInfo.classList.add('hidden');
    }
}

function updateButtonStates(connected) {
    document.getElementById('swap-btn').disabled = !connected;
    document.getElementById('public-swap-btn').disabled = !connected;
    document.getElementById('add-liquidity-btn').disabled = !connected;
    document.getElementById('remove-liquidity-btn').disabled = !connected;
    document.getElementById('deposit-btn').disabled = !connected;
    document.getElementById('withdraw-btn').disabled = !connected;

    // Recovery buttons
    const clearRebuildBtn = document.getElementById('clear-rebuild-btn');
    if (clearRebuildBtn) {
        clearRebuildBtn.disabled = !connected;
    }

    const recoveryBtn = document.getElementById('recover-utxo-btn');
    if (recoveryBtn) {
        recoveryBtn.disabled = !connected;
    }

    const manualRecoveryBtn = document.getElementById('manual-recover-btn');
    if (manualRecoveryBtn) {
        manualRecoveryBtn.disabled = !connected;
    }

    if (connected) {
        document.getElementById('swap-btn').textContent = 'Swap';
        document.getElementById('public-swap-btn').textContent = 'Swap';
    } else {
        document.getElementById('swap-btn').textContent = 'Connect Wallet to Swap';
        document.getElementById('public-swap-btn').textContent = 'Connect Wallet to Swap';
    }
}

// ============================================================================
// Swap Functions
// ============================================================================

function initSwap() {
    const fromAmountInput = document.getElementById('swap-from-amount');
    const directionBtn = document.getElementById('swap-direction');
    const swapBtn = document.getElementById('swap-btn');

    fromAmountInput.addEventListener('input', updateSwapQuote);
    directionBtn.addEventListener('click', swapDirection);
    swapBtn.addEventListener('click', executeSwap);
}

function updateSwapQuote() {
    const fromAmount = parseFloat(document.getElementById('swap-from-amount').value) || 0;
    const fromToken = document.getElementById('swap-from-token').value;
    const toToken = document.getElementById('swap-to-token').value;

    if (!state.poolState || fromAmount === 0) {
        document.getElementById('swap-to-amount').value = '';
        return;
    }

    // Calculate output using constant product formula
    const { reserveA, reserveB } = state.poolState;
    let amountOut;

    if (fromToken === 'SOL') {
        // SOL -> USDC
        const amountIn = fromAmount * 1e9; // Convert to lamports
        amountOut = calculateSwapOutput(amountIn, reserveA, reserveB);
        amountOut = amountOut / 1e6; // Convert to USDC
    } else {
        // USDC -> SOL
        const amountIn = fromAmount * 1e6; // Convert to smallest unit
        amountOut = calculateSwapOutput(amountIn, reserveB, reserveA);
        amountOut = amountOut / 1e9; // Convert to SOL
    }

    document.getElementById('swap-to-amount').value = amountOut.toFixed(6);

    // Update price impact
    const priceImpact = calculatePriceImpact(fromAmount, fromToken);
    document.getElementById('price-impact').textContent = priceImpact.toFixed(2) + '%';
}

function calculateSwapOutput(amountIn, reserveIn, reserveOut) {
    // x * y = k, with 0.3% fee
    const amountInWithFee = amountIn * 997;
    const numerator = amountInWithFee * reserveOut;
    const denominator = reserveIn * 1000 + amountInWithFee;
    return Math.floor(numerator / denominator);
}

function calculatePriceImpact(amount, token) {
    if (!state.poolState || amount === 0) return 0;
    // Simplified price impact calculation
    const { reserveA } = state.poolState;
    const amountIn = token === 'SOL' ? amount * 1e9 : amount * 1e6;
    return (amountIn / reserveA) * 100;
}

function swapDirection() {
    const fromToken = document.getElementById('swap-from-token');
    const toToken = document.getElementById('swap-to-token');

    const temp = fromToken.value;
    fromToken.value = toToken.value;
    toToken.value = temp;

    updateSwapQuote();
}

async function executeSwap() {
    const fromAmount = parseFloat(document.getElementById('swap-from-amount').value);
    const toAmount = parseFloat(document.getElementById('swap-to-amount').value);
    const fromToken = document.getElementById('swap-from-token').value;

    if (!fromAmount || !toAmount) {
        alert('Please enter an amount');
        return;
    }

    if (!state.utxoStorage) {
        alert('Please connect wallet first');
        return;
    }

    showTxModal('Syncing Merkle tree...');

    try {
        // CRITICAL: Sync Merkle tree from chain before swap
        try {
            state.merkleTree = await syncMerkleTreeFromChain(
                CONFIG.rpcUrl,
                CONFIG.poolAccounts.merkleAccount
            );
            console.log(`Merkle tree synced: ${state.merkleTree.getLeafCount()} leaves`);
        } catch (syncErr) {
            console.error('Failed to sync Merkle tree:', syncErr);
            throw new Error('Failed to sync with blockchain. Please try again.');
        }

        updateTxStatus('Selecting UTXOs...');

        // Determine asset IDs
        const fromAssetId = fromToken === 'SOL' ? ASSET_SOL : ASSET_USDC;
        const toAssetId = fromToken === 'SOL' ? ASSET_USDC : ASSET_SOL;

        // Convert amounts to smallest unit
        const fromAmountRaw = fromToken === 'SOL' ? Math.floor(fromAmount * 1e9) : Math.floor(fromAmount * 1e6);
        const toAmountRaw = fromToken === 'SOL' ? Math.floor(toAmount * 1e6) : Math.floor(toAmount * 1e9);

        // Debug: show all UTXOs in storage
        const allStoredUtxos = state.utxoStorage.getAll();
        console.log('=== UTXO Debug ===');
        console.log('All stored UTXOs:', allStoredUtxos);
        console.log('Looking for assetId:', fromAssetId, '(type:', typeof fromAssetId, ')');
        console.log('Target amount:', fromAmountRaw);

        allStoredUtxos.forEach((u, i) => {
            console.log(`UTXO ${i}: assetId=${u.assetId} (type: ${typeof u.assetId}), amount=${u.amount}, spent=${u.spent}`);
        });

        const matchingUtxos = allStoredUtxos.filter(u => u.assetId === fromAssetId && !u.spent);
        console.log('Matching UTXOs (same assetId, not spent):', matchingUtxos);

        const balanceForAsset = state.utxoStorage.getBalance(fromAssetId);
        console.log('Balance for asset:', balanceForAsset.toString());
        console.log('=== End Debug ===');

        // Select UTXOs for input
        let selection;
        try {
            selection = state.utxoStorage.selectUtxos(fromAssetId, fromAmountRaw);
        } catch (selectErr) {
            console.error('selectUtxos failed:', selectErr);
            throw new Error(`Insufficient private ${fromToken} balance. Please deposit first or recover your UTXOs. (Balance: ${balanceForAsset.toString()}, Need: ${fromAmountRaw})`);
        }

        if (selection.utxos.length === 0) {
            throw new Error(`No private ${fromToken} balance. Please deposit first or recover your UTXOs.`);
        }

        // Get all unspent UTXOs of the same asset type (circuit requires same-asset inputs)
        const allUtxos = state.utxoStorage.getUnspent();
        const sameAssetUtxos = allUtxos.filter(u => u.assetId === fromAssetId);

        // Check if we have at least 2 UTXOs of the same asset (circuit requirement)
        if (sameAssetUtxos.length < 2) {
            throw new Error(
                `Private swap requires at least 2 ${fromToken} UTXOs. ` +
                `You currently have ${sameAssetUtxos.length} ${fromToken} UTXO(s). ` +
                `Please make ${2 - sameAssetUtxos.length} more ${fromToken} deposit(s) first, or use Public Swap instead.`
            );
        }

        updateTxStatus('Validating UTXOs...');

        // Validate that UTXOs are in the Merkle tree
        // If leafIndex is wrong, try to find the correct index
        for (const utxo of selection.utxos) {
            const treeLeaves = state.merkleTree.leaves;
            console.log(`Validating UTXO: commitment=${utxo.commitment.slice(0, 20)}..., leafIndex=${utxo.leafIndex}`);

            // First check if the stored leafIndex is correct
            if (utxo.leafIndex !== undefined && utxo.leafIndex < treeLeaves.length) {
                const treeCommitment = treeLeaves[utxo.leafIndex];
                if (treeCommitment === utxo.commitment) {
                    console.log(`UTXO validated at leafIndex ${utxo.leafIndex}`);
                    continue; // Valid!
                }
            }

            // LeafIndex is wrong - try to find the commitment in the tree
            console.log(`LeafIndex ${utxo.leafIndex} invalid, searching tree for commitment...`);
            let foundIndex = -1;
            for (let i = 0; i < treeLeaves.length; i++) {
                if (treeLeaves[i] === utxo.commitment) {
                    foundIndex = i;
                    break;
                }
            }

            if (foundIndex >= 0) {
                console.log(`Found commitment at index ${foundIndex}, updating UTXO`);
                utxo.leafIndex = foundIndex;
                // Save the corrected leafIndex
                await state.utxoStorage.save();
            } else {
                console.error('Commitment not found in tree:', {
                    stored: utxo.commitment,
                    treeSize: treeLeaves.length,
                    firstFewLeaves: treeLeaves.slice(0, 5),
                });
                throw new Error(
                    `UTXO commitment not found on-chain. This UTXO may not have been deposited successfully. ` +
                    `Try using Auto-Recover to find your UTXOs.`
                );
            }
        }

        updateTxStatus('Building input UTXOs...');

        // Build input UTXOs with Merkle proofs
        const inputUtxos = [];
        for (let i = 0; i < 2; i++) {
            let utxo, proof;

            if (i < selection.utxos.length) {
                utxo = selection.utxos[i];
            } else {
                // Need a second input for the circuit - find another same-asset UTXO not in selection
                const otherUtxo = sameAssetUtxos.find(u =>
                    !selection.utxos.some(s => s.commitment === u.commitment) &&
                    u.leafIndex !== undefined
                );

                if (!otherUtxo) {
                    throw new Error('Cannot find a second UTXO of the same asset. This should not happen.');
                }

                utxo = otherUtxo;
            }

            // Get Merkle proof for this UTXO
            proof = state.merkleTree.getProof(utxo.leafIndex);
            const treeCommitment = state.merkleTree.leaves[utxo.leafIndex];
            console.log(`Input UTXO ${i}: leafIndex=${utxo.leafIndex}, amount=${utxo.amount}, assetId=${utxo.assetId}`);
            console.log(`  Stored commitment: ${utxo.commitment?.slice(0, 30)}...`);
            console.log(`  Tree commitment:   ${treeCommitment?.slice(0, 30)}...`);
            console.log(`  Blinding: ${utxo.blinding?.slice(0, 30)}...`);

            inputUtxos.push({
                amount: utxo.amount || '0',
                assetId: fromAssetId.toString(),
                privateKey: state.privateKey,
                blinding: utxo.blinding,
                pathElements: proof.pathElements,
                pathIndices: proof.pathIndices,
            });
        }

        // Calculate total input amount from ALL input UTXOs
        const totalInputAmount = inputUtxos.reduce(
            (sum, u) => sum + BigInt(u.amount),
            0n
        );
        // Change = total input - swap amount
        const changeAmount = totalInputAmount - BigInt(fromAmountRaw);

        console.log(`Total input: ${totalInputAmount}, Swap: ${fromAmountRaw}, Change: ${changeAmount}`);

        // Build output UTXOs
        // Output 0: What user receives from the swap (in the target asset)
        // Output 1: Change returned to user (in the source asset)
        const outputUtxos = [
            {
                amount: toAmountRaw.toString(),
                assetId: toAssetId.toString(),
                pubkey: state.zkPubkey,
                blinding: randomFieldElement(),
            },
            {
                amount: changeAmount.toString(),
                assetId: fromAssetId.toString(),
                pubkey: state.zkPubkey,
                blinding: randomFieldElement(),
            },
        ];

        // Build pool state
        const { reserveA, reserveB } = state.poolState;
        const poolBlinding = randomFieldElement();
        const newPoolBlinding = randomFieldElement();

        let newReserveA, newReserveB;
        if (fromToken === 'SOL') {
            newReserveA = (BigInt(reserveA) + BigInt(fromAmountRaw)).toString();
            newReserveB = (BigInt(reserveB) - BigInt(toAmountRaw)).toString();
        } else {
            newReserveA = (BigInt(reserveA) - BigInt(toAmountRaw)).toString();
            newReserveB = (BigInt(reserveB) + BigInt(fromAmountRaw)).toString();
        }

        updateTxStatus('Generating ZK proof... (this may take 30-60 seconds)');

        // Generate real ZK proof
        const proofResult = await generateSwapProof({
            root: state.merkleTree.getRoot(),
            inputUtxos,
            outputUtxos,
            poolState: {
                reserveA: reserveA.toString(),
                reserveB: reserveB.toString(),
                poolPubkey: CONFIG.poolAccounts.poolAccount,
                poolBlinding,
            },
            newPoolState: {
                reserveA: newReserveA,
                reserveB: newReserveB,
                poolBlinding: newPoolBlinding,
            },
            swapParams: {
                amountIn: fromAmountRaw.toString(),
                assetIn: fromAssetId.toString(),
                amountOut: toAmountRaw.toString(),
                minAmountOut: Math.floor(toAmountRaw * 0.99).toString(), // 1% slippage
            },
            extDataHash: '0',
        });

        updateTxStatus('Submitting to relayer...');

        // Submit to relayer
        const response = await fetch(`${CONFIG.relayerUrl}/swap`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                proof: proofResult.proof,
                publicSignals: proofResult.publicSignals,
                nullifiers: proofResult.inputNullifiers,
                outputCommitments: proofResult.outputCommitments,
                newPoolStateHash: proofResult.newPoolStateHash,
                newPoolBlinding,
            }),
        });

        const result = await response.json();

        if (result.success) {
            // Mark input UTXOs as spent
            for (const utxo of selection.utxos) {
                await state.utxoStorage.markSpent(utxo.commitment, proofResult.inputNullifiers[0]);
            }

            // Add output UTXOs
            for (let i = 0; i < outputUtxos.length; i++) {
                if (BigInt(outputUtxos[i].amount) > 0n) {
                    await state.utxoStorage.addUtxo({
                        commitment: proofResult.outputCommitments[i],
                        amount: outputUtxos[i].amount,
                        assetId: parseInt(outputUtxos[i].assetId),
                        blinding: outputUtxos[i].blinding,
                        leafIndex: state.merkleTree.getLeafCount() + i,
                    });
                }
            }

            updatePortfolio();
            showTxSuccess(result.signature, result.explorer);
        } else {
            showTxError(result.error || 'Swap failed');
        }

    } catch (err) {
        console.error('Swap failed:', err);
        showTxError(err.message);
    }
}

/**
 * Create a valid dummy UTXO for the circuit
 * The circuit requires 2 input UTXOs. If user only has 1, we need a valid dummy.
 *
 * IMPORTANT: The dummy UTXO's commitment must exist in the Merkle tree.
 * Since we can't create a new commitment on-the-fly, we must use an existing one.
 *
 * For MVP: We require users to have 2 UTXOs. This function throws if we can't
 * create a valid dummy (which means the user needs to deposit more).
 */
async function createValidDummyUtxo(assetId) {
    // Check if user has any other UTXOs that can be used as dummy (amount 0 UTXOs)
    const allUtxos = state.utxoStorage.getUnspent();
    const zeroUtxo = allUtxos.find(u => u.amount === '0' || BigInt(u.amount) === 0n);

    if (zeroUtxo) {
        return zeroUtxo;
    }

    // No zero-amount UTXO available
    // For the circuit to work, we need a commitment that exists in the Merkle tree
    // The only way to have this is to have deposited a zero-amount UTXO previously

    throw new Error(
        'Private swap requires 2 UTXOs. You currently have only 1. ' +
        'Please make another small deposit first, or use Public Swap instead.'
    );
}

// Keep old function for backward compatibility but mark deprecated
function createDummyUtxo(assetId) {
    console.warn('createDummyUtxo is deprecated, use createValidDummyUtxo');
    return {
        amount: '0',
        assetId,
        blinding: randomFieldElement(),
        leafIndex: 0,
    };
}

// ============================================================================
// Public Swap Functions (Direct SPL Token Swap)
// ============================================================================

function initPublicSwap() {
    // Swap mode toggle
    const swapModeTabs = document.querySelectorAll('.swap-mode-tabs .tab-btn');
    swapModeTabs.forEach(btn => {
        btn.addEventListener('click', () => {
            swapModeTabs.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const mode = btn.dataset.swapMode;
            document.getElementById('public-swap-form').classList.toggle('hidden', mode !== 'public');
            document.getElementById('private-swap-form').classList.toggle('hidden', mode !== 'private');
        });
    });

    // Public swap event listeners
    const fromAmountInput = document.getElementById('public-swap-from-amount');
    const directionBtn = document.getElementById('public-swap-direction');
    const swapBtn = document.getElementById('public-swap-btn');

    fromAmountInput.addEventListener('input', updatePublicSwapQuote);
    directionBtn.addEventListener('click', publicSwapDirection);
    swapBtn.addEventListener('click', executePublicSwap);

    // Wrap/Unwrap SOL buttons
    document.getElementById('wrap-sol-btn').addEventListener('click', wrapSol);
    document.getElementById('unwrap-sol-btn').addEventListener('click', unwrapSol);

    // Token select change events
    document.getElementById('public-swap-from-token').addEventListener('change', updatePublicSwapQuote);
    document.getElementById('public-swap-to-token').addEventListener('change', updatePublicSwapQuote);
}

function updatePublicSwapQuote() {
    const fromAmount = parseFloat(document.getElementById('public-swap-from-amount').value) || 0;
    const fromToken = document.getElementById('public-swap-from-token').value;
    const toToken = document.getElementById('public-swap-to-token').value;

    if (!state.poolState || fromAmount === 0) {
        document.getElementById('public-swap-to-amount').value = '';
        document.getElementById('public-swap-rate').textContent = fromToken === 'wSOL' ? '1 wSOL = -- tUSDC' : '1 tUSDC = -- wSOL';
        document.getElementById('public-price-impact').textContent = '--';
        return;
    }

    // Calculate output using constant product formula (with 0.3% fee)
    const { reserveA, reserveB } = state.poolState;
    let amountIn, amountOut, reserveIn, reserveOut;

    if (fromToken === 'wSOL') {
        // wSOL -> tUSDC
        amountIn = fromAmount * 1e9; // Convert to lamports
        reserveIn = reserveA;
        reserveOut = reserveB;
        amountOut = calculateSwapOutput(amountIn, reserveIn, reserveOut);
        amountOut = amountOut / 1e6; // Convert to tUSDC
    } else {
        // tUSDC -> wSOL
        amountIn = fromAmount * 1e6; // Convert to smallest unit
        reserveIn = reserveB;
        reserveOut = reserveA;
        amountOut = calculateSwapOutput(amountIn, reserveIn, reserveOut);
        amountOut = amountOut / 1e9; // Convert to wSOL
    }

    document.getElementById('public-swap-to-amount').value = amountOut.toFixed(6);

    // Update rate display
    const rate = fromToken === 'wSOL'
        ? (reserveB / reserveA * 1e3).toFixed(2)
        : (reserveA / reserveB / 1e3).toFixed(6);
    document.getElementById('public-swap-rate').textContent = fromToken === 'wSOL'
        ? `1 wSOL = ${rate} tUSDC`
        : `1 tUSDC = ${rate} wSOL`;

    // Update price impact
    const priceImpact = (amountIn / reserveIn) * 100;
    document.getElementById('public-price-impact').textContent = priceImpact.toFixed(3) + '%';
}

function publicSwapDirection() {
    const fromToken = document.getElementById('public-swap-from-token');
    const toToken = document.getElementById('public-swap-to-token');

    const temp = fromToken.value;
    fromToken.value = toToken.value;
    toToken.value = temp;

    updatePublicSwapQuote();
    if (state.publicKey) {
        fetchTokenBalances();
    }
}

async function executePublicSwap() {
    const fromAmount = parseFloat(document.getElementById('public-swap-from-amount').value);
    const toAmount = parseFloat(document.getElementById('public-swap-to-amount').value);
    const fromToken = document.getElementById('public-swap-from-token').value;

    if (!fromAmount || !toAmount) {
        alert('Please enter an amount');
        return;
    }

    if (!state.wallet || !state.publicKey) {
        alert('Please connect wallet first');
        return;
    }

    showTxModal('Building transaction...');

    try {
        // Load Solana Web3.js
        const { Connection, PublicKey, Transaction, TransactionInstruction } = window.solanaWeb3 || await loadSolanaWeb3();

        const connection = new Connection(CONFIG.rpcUrl, 'confirmed');

        // Convert amounts to smallest unit
        const amountIn = fromToken === 'wSOL'
            ? Math.floor(fromAmount * 1e9)
            : Math.floor(fromAmount * 1e6);
        // 5% slippage tolerance (now using real on-chain pool state)
        const minAmountOut = fromToken === 'wSOL'
            ? Math.floor(toAmount * 0.95 * 1e6)
            : Math.floor(toAmount * 0.95 * 1e9);

        updateTxStatus('Getting token accounts...');

        // Get user's associated token accounts (ATAs)
        const userPubkey = new PublicKey(state.publicKey);
        const wsolMint = new PublicKey(CONFIG.tokenAccounts.wsolMint);
        const usdcMint = new PublicKey(CONFIG.tokenAccounts.usdcMint);

        // SPL Token Program and Associated Token Program
        const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
        const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

        // Derive user's ATAs
        const userWsolAta = await getAssociatedTokenAddress(userPubkey, wsolMint);
        const userUsdcAta = await getAssociatedTokenAddress(userPubkey, usdcMint);

        // Determine input/output accounts based on swap direction
        let userTokenIn, userTokenOut, poolVaultIn, poolVaultOut, outputMint;
        if (fromToken === 'wSOL') {
            userTokenIn = userWsolAta;
            userTokenOut = userUsdcAta;
            poolVaultIn = new PublicKey(CONFIG.tokenAccounts.poolWsolVault);
            poolVaultOut = new PublicKey(CONFIG.tokenAccounts.poolUsdcVault);
            outputMint = usdcMint;
        } else {
            userTokenIn = userUsdcAta;
            userTokenOut = userWsolAta;
            poolVaultIn = new PublicKey(CONFIG.tokenAccounts.poolUsdcVault);
            poolVaultOut = new PublicKey(CONFIG.tokenAccounts.poolWsolVault);
            outputMint = wsolMint;
        }

        // Check if user's output token account exists, if not we need to create it
        updateTxStatus('Checking output token account...');
        const outputAccountInfo = await connection.getAccountInfo(userTokenOut);
        const needCreateOutputAta = !outputAccountInfo;

        if (needCreateOutputAta) {
            console.log('Output token account does not exist, will create it');
        }

        updateTxStatus('Building PublicSwap instruction...');

        // Build instruction data: [instruction_id: u8, amount_in: u64, min_amount_out: u64, direction: u8]
        // direction: 0 = A→B (wSOL→tUSDC), 1 = B→A (tUSDC→wSOL)
        const instructionData = new Uint8Array(1 + 8 + 8 + 1);
        let offset = 0;

        // Instruction ID: 6 = PublicSwap
        instructionData[offset++] = 6;

        // Amount in (8 bytes, little-endian)
        let amountInBigInt = BigInt(amountIn);
        for (let i = 0; i < 8; i++) {
            instructionData[offset++] = Number(amountInBigInt & 0xFFn);
            amountInBigInt >>= 8n;
        }

        // Min amount out (8 bytes, little-endian)
        let minAmountOutBigInt = BigInt(minAmountOut);
        for (let i = 0; i < 8; i++) {
            instructionData[offset++] = Number(minAmountOutBigInt & 0xFFn);
            minAmountOutBigInt >>= 8n;
        }

        // Direction (1 byte): 0 = wSOL→tUSDC (A→B), 1 = tUSDC→wSOL (B→A)
        const direction = fromToken === 'wSOL' ? 0 : 1;
        instructionData[offset++] = direction;

        // Get recent blockhash
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

        // Create transaction
        const transaction = new Transaction({
            recentBlockhash: blockhash,
            feePayer: userPubkey,
        });

        // If output token account doesn't exist, add instruction to create it first
        if (needCreateOutputAta) {
            updateTxStatus('Adding create ATA instruction...');
            const { SystemProgram } = window.solanaWeb3;
            const createAtaIx = new TransactionInstruction({
                programId: ASSOCIATED_TOKEN_PROGRAM_ID,
                keys: [
                    { pubkey: userPubkey, isSigner: true, isWritable: true },
                    { pubkey: userTokenOut, isSigner: false, isWritable: true },
                    { pubkey: userPubkey, isSigner: false, isWritable: false },
                    { pubkey: outputMint, isSigner: false, isWritable: false },
                    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                ],
                data: Buffer.alloc(0),
            });
            transaction.add(createAtaIx);
        }

        // PublicSwap instruction with 8 accounts
        const publicSwapInstruction = new TransactionInstruction({
            programId: new PublicKey(CONFIG.programId),
            keys: [
                { pubkey: userPubkey, isSigner: true, isWritable: true },                    // [0] swapper
                { pubkey: new PublicKey(CONFIG.poolAccounts.poolAccount), isSigner: false, isWritable: true }, // [1] pool_account
                { pubkey: userTokenIn, isSigner: false, isWritable: true },                  // [2] user_token_in
                { pubkey: userTokenOut, isSigner: false, isWritable: true },                 // [3] user_token_out
                { pubkey: poolVaultIn, isSigner: false, isWritable: true },                  // [4] pool_vault_in
                { pubkey: poolVaultOut, isSigner: false, isWritable: true },                 // [5] pool_vault_out
                { pubkey: new PublicKey(CONFIG.poolAccounts.poolAuthority), isSigner: false, isWritable: false }, // [6] pool_authority
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },            // [7] token_program
            ],
            data: Buffer.from(instructionData),
        });
        transaction.add(publicSwapInstruction);

        updateTxStatus('Please approve in wallet...');

        // Sign and send transaction
        const signed = await state.wallet.signTransaction(transaction);
        const signature = await connection.sendRawTransaction(signed.serialize());

        updateTxStatus('Confirming transaction...');

        // Wait for confirmation
        await connection.confirmTransaction({
            signature,
            blockhash,
            lastValidBlockHeight,
        });

        // Refresh balances
        await fetchTokenBalances();
        await loadPoolState();

        showTxSuccess(signature, `https://explorer.solana.com/tx/${signature}?cluster=testnet`);

    } catch (err) {
        console.error('Public swap failed:', err);
        showTxError(err.message);
    }
}

// Get Associated Token Address (ATA)
async function getAssociatedTokenAddress(owner, mint) {
    const { PublicKey } = window.solanaWeb3 || await loadSolanaWeb3();
    const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
    const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

    const [ata] = PublicKey.findProgramAddressSync(
        [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM_ID
    );
    return ata;
}

// Fetch user's SPL Token balances and native SOL
async function fetchTokenBalances() {
    if (!state.publicKey) return;

    try {
        const { Connection, PublicKey, LAMPORTS_PER_SOL } = window.solanaWeb3 || await loadSolanaWeb3();
        const connection = new Connection(CONFIG.rpcUrl, 'confirmed');

        const userPubkey = new PublicKey(state.publicKey);
        const wsolMint = new PublicKey(CONFIG.tokenAccounts.wsolMint);
        const usdcMint = new PublicKey(CONFIG.tokenAccounts.usdcMint);

        // Get native SOL balance
        const nativeSolBalance = await connection.getBalance(userPubkey);
        const nativeSol = nativeSolBalance / LAMPORTS_PER_SOL;
        document.getElementById('native-sol-balance').textContent = nativeSol.toFixed(4);

        // Get ATAs
        const userWsolAta = await getAssociatedTokenAddress(userPubkey, wsolMint);
        const userUsdcAta = await getAssociatedTokenAddress(userPubkey, usdcMint);

        // Fetch balances
        let wsolBalance = 0;
        let usdcBalance = 0;

        try {
            const wsolInfo = await connection.getTokenAccountBalance(userWsolAta);
            wsolBalance = parseFloat(wsolInfo.value.uiAmountString) || 0;
        } catch (e) {
            // Account doesn't exist
            wsolBalance = 0;
        }

        try {
            const usdcInfo = await connection.getTokenAccountBalance(userUsdcAta);
            usdcBalance = parseFloat(usdcInfo.value.uiAmountString) || 0;
        } catch (e) {
            // Account doesn't exist
            usdcBalance = 0;
        }

        // Update UI
        const fromToken = document.getElementById('public-swap-from-token').value;
        const toToken = document.getElementById('public-swap-to-token').value;

        document.getElementById('public-from-balance').textContent = fromToken === 'wSOL'
            ? wsolBalance.toFixed(4)
            : usdcBalance.toFixed(2);
        document.getElementById('public-to-balance').textContent = toToken === 'wSOL'
            ? wsolBalance.toFixed(4)
            : usdcBalance.toFixed(2);

        console.log(`Balances - Native SOL: ${nativeSol}, wSOL: ${wsolBalance}, tUSDC: ${usdcBalance}`);

    } catch (err) {
        console.error('Failed to fetch token balances:', err);
    }
}

// Wrap native SOL to wSOL
async function wrapSol() {
    if (!state.wallet || !state.publicKey) {
        alert('Please connect wallet first');
        return;
    }

    const amountStr = prompt('Enter amount of SOL to wrap:', '0.1');
    if (!amountStr) return;

    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
        alert('Invalid amount');
        return;
    }

    showTxModal('Wrapping SOL to wSOL...');

    try {
        const { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram, LAMPORTS_PER_SOL } = window.solanaWeb3 || await loadSolanaWeb3();

        const connection = new Connection(CONFIG.rpcUrl, 'confirmed');
        const userPubkey = new PublicKey(state.publicKey);
        const wsolMint = new PublicKey(CONFIG.tokenAccounts.wsolMint);
        const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
        const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

        // Get user's wSOL ATA
        const userWsolAta = await getAssociatedTokenAddress(userPubkey, wsolMint);

        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

        const transaction = new Transaction({
            recentBlockhash: blockhash,
            feePayer: userPubkey,
        });

        // Check if wSOL ATA exists
        const ataInfo = await connection.getAccountInfo(userWsolAta);

        if (!ataInfo) {
            updateTxStatus('Creating wSOL token account...');
            // Create Associated Token Account instruction
            const createAtaIx = new TransactionInstruction({
                programId: ASSOCIATED_TOKEN_PROGRAM_ID,
                keys: [
                    { pubkey: userPubkey, isSigner: true, isWritable: true },
                    { pubkey: userWsolAta, isSigner: false, isWritable: true },
                    { pubkey: userPubkey, isSigner: false, isWritable: false },
                    { pubkey: wsolMint, isSigner: false, isWritable: false },
                    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                ],
                data: Buffer.alloc(0),
            });
            transaction.add(createAtaIx);
        }

        // Transfer SOL to wSOL ATA
        updateTxStatus('Transferring SOL...');
        const lamports = Math.floor(amount * LAMPORTS_PER_SOL);
        const transferIx = SystemProgram.transfer({
            fromPubkey: userPubkey,
            toPubkey: userWsolAta,
            lamports,
        });
        transaction.add(transferIx);

        // Sync native instruction (tells the token program to update the balance)
        const syncNativeIx = new TransactionInstruction({
            programId: TOKEN_PROGRAM_ID,
            keys: [
                { pubkey: userWsolAta, isSigner: false, isWritable: true },
            ],
            data: Buffer.from([17]), // SyncNative instruction = 17
        });
        transaction.add(syncNativeIx);

        updateTxStatus('Please approve in wallet...');

        const signed = await state.wallet.signTransaction(transaction);
        const signature = await connection.sendRawTransaction(signed.serialize());

        updateTxStatus('Confirming transaction...');

        await connection.confirmTransaction({
            signature,
            blockhash,
            lastValidBlockHeight,
        });

        await fetchTokenBalances();
        showTxSuccess(signature, `https://explorer.solana.com/tx/${signature}?cluster=testnet`);

    } catch (err) {
        console.error('Wrap SOL failed:', err);
        showTxError(err.message);
    }
}

// Unwrap wSOL to native SOL
async function unwrapSol() {
    if (!state.wallet || !state.publicKey) {
        alert('Please connect wallet first');
        return;
    }

    showTxModal('Unwrapping wSOL to SOL...');

    try {
        const { Connection, PublicKey, Transaction, TransactionInstruction } = window.solanaWeb3 || await loadSolanaWeb3();

        const connection = new Connection(CONFIG.rpcUrl, 'confirmed');
        const userPubkey = new PublicKey(state.publicKey);
        const wsolMint = new PublicKey(CONFIG.tokenAccounts.wsolMint);
        const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

        // Get user's wSOL ATA
        const userWsolAta = await getAssociatedTokenAddress(userPubkey, wsolMint);

        // Check balance
        let wsolBalance = 0;
        try {
            const wsolInfo = await connection.getTokenAccountBalance(userWsolAta);
            wsolBalance = parseFloat(wsolInfo.value.uiAmountString) || 0;
        } catch (e) {
            throw new Error('No wSOL token account found');
        }

        if (wsolBalance <= 0) {
            throw new Error('No wSOL balance to unwrap');
        }

        updateTxStatus(`Closing wSOL account (${wsolBalance.toFixed(4)} wSOL)...`);

        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

        const transaction = new Transaction({
            recentBlockhash: blockhash,
            feePayer: userPubkey,
        });

        // CloseAccount instruction - returns all SOL (rent + wSOL balance) to owner
        const closeAccountIx = new TransactionInstruction({
            programId: TOKEN_PROGRAM_ID,
            keys: [
                { pubkey: userWsolAta, isSigner: false, isWritable: true },
                { pubkey: userPubkey, isSigner: false, isWritable: true },
                { pubkey: userPubkey, isSigner: true, isWritable: false },
            ],
            data: Buffer.from([9]), // CloseAccount instruction = 9
        });
        transaction.add(closeAccountIx);

        updateTxStatus('Please approve in wallet...');

        const signed = await state.wallet.signTransaction(transaction);
        const signature = await connection.sendRawTransaction(signed.serialize());

        updateTxStatus('Confirming transaction...');

        await connection.confirmTransaction({
            signature,
            blockhash,
            lastValidBlockHeight,
        });

        await fetchTokenBalances();
        showTxSuccess(signature, `https://explorer.solana.com/tx/${signature}?cluster=testnet`);

    } catch (err) {
        console.error('Unwrap SOL failed:', err);
        showTxError(err.message);
    }
}

// Show setup tokens modal/instructions
function showSetupTokensModal() {
    alert(`To use Public Swap, you need:

1. wSOL (Wrapped SOL) - Wrap your SOL using:
   spl-token wrap <amount>

2. tUSDC token account - Get test USDC from faucet

Token Addresses:
- wSOL Mint: So11111111111111111111111111111111111111112
- tUSDC Mint: ${CONFIG.tokenAccounts.usdcMint}

Use Solana CLI or a DEX to get these tokens.`);
}

// ============================================================================
// Liquidity Functions
// ============================================================================

function initLiquidity() {
    const tabBtns = document.querySelectorAll('.tabs-inner .tab-btn');
    const addBtn = document.getElementById('add-liquidity-btn');
    const removeBtn = document.getElementById('remove-liquidity-btn');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const action = btn.dataset.action;
            document.getElementById('add-liquidity').classList.toggle('hidden', action !== 'add');
            document.getElementById('remove-liquidity').classList.toggle('hidden', action !== 'remove');
        });
    });

    addBtn.addEventListener('click', executeAddLiquidity);
    removeBtn.addEventListener('click', executeRemoveLiquidity);

    // Update LP estimates on input
    document.getElementById('add-token-a').addEventListener('input', updateLpEstimate);
    document.getElementById('add-token-b').addEventListener('input', updateLpEstimate);
    document.getElementById('remove-lp').addEventListener('input', updateRemoveEstimate);
}

function updateLpEstimate() {
    const tokenA = parseFloat(document.getElementById('add-token-a').value) || 0;
    const tokenB = parseFloat(document.getElementById('add-token-b').value) || 0;

    if (!state.poolState || tokenA === 0 || tokenB === 0) {
        document.getElementById('lp-receive').textContent = '0.00';
        document.getElementById('pool-share').textContent = '0.00%';
        return;
    }

    // Calculate LP tokens: min(tokenA/reserveA, tokenB/reserveB) * totalLpSupply
    const { reserveA, reserveB, totalLpSupply } = state.poolState;
    const ratioA = (tokenA * 1e9) / reserveA;
    const ratioB = (tokenB * 1e6) / reserveB;
    const lpAmount = Math.min(ratioA, ratioB) * totalLpSupply / 1e6;

    document.getElementById('lp-receive').textContent = lpAmount.toFixed(2);

    const newTotal = parseFloat(totalLpSupply) / 1e6 + lpAmount;
    const share = (lpAmount / newTotal) * 100;
    document.getElementById('pool-share').textContent = share.toFixed(2) + '%';
}

function updateRemoveEstimate() {
    const lpAmount = parseFloat(document.getElementById('remove-lp').value) || 0;

    if (!state.poolState || lpAmount === 0) {
        document.getElementById('receive-sol').textContent = '0.00';
        document.getElementById('receive-usdc').textContent = '0.00';
        return;
    }

    const { reserveA, reserveB, totalLpSupply } = state.poolState;
    const share = (lpAmount * 1e6) / totalLpSupply;

    const solAmount = (share * reserveA) / 1e9;
    const usdcAmount = (share * reserveB) / 1e6;

    document.getElementById('receive-sol').textContent = solAmount.toFixed(4);
    document.getElementById('receive-usdc').textContent = usdcAmount.toFixed(2);
}

async function executeAddLiquidity() {
    const tokenA = parseFloat(document.getElementById('add-token-a').value);
    const tokenB = parseFloat(document.getElementById('add-token-b').value);

    if (!tokenA || !tokenB) {
        alert('Please enter amounts for both tokens');
        return;
    }

    if (!state.utxoStorage) {
        alert('Please connect wallet first');
        return;
    }

    showTxModal('Selecting UTXOs...');

    try {
        const amountA = Math.floor(tokenA * 1e9);
        const amountB = Math.floor(tokenB * 1e6);

        // Select UTXOs for both tokens
        const selectionA = state.utxoStorage.selectUtxos(ASSET_SOL, amountA);
        const selectionB = state.utxoStorage.selectUtxos(ASSET_USDC, amountB);

        updateTxStatus('Building input UTXOs...');

        // Build input UTXOs
        const inputUtxos = [
            {
                amount: selectionA.utxos[0]?.amount || '0',
                privateKey: state.privateKey,
                blinding: selectionA.utxos[0]?.blinding || randomFieldElement(),
                pathElements: state.merkleTree.getProof(selectionA.utxos[0]?.leafIndex || 0).pathElements,
                pathIndices: state.merkleTree.getProof(selectionA.utxos[0]?.leafIndex || 0).pathIndices,
            },
            {
                amount: selectionB.utxos[0]?.amount || '0',
                privateKey: state.privateKey,
                blinding: selectionB.utxos[0]?.blinding || randomFieldElement(),
                pathElements: state.merkleTree.getProof(selectionB.utxos[0]?.leafIndex || 0).pathElements,
                pathIndices: state.merkleTree.getProof(selectionB.utxos[0]?.leafIndex || 0).pathIndices,
            },
        ];

        // Calculate LP tokens to receive
        const { reserveA, reserveB, totalLpSupply } = state.poolState;
        const lpAmount = Math.floor(Math.sqrt(amountA * amountB));

        const outputUtxo = {
            lpAmount: lpAmount.toString(),
            pubkey: state.zkPubkey,
            blinding: randomFieldElement(),
        };

        updateTxStatus('Generating ZK proof... (this may take 30-60 seconds)');

        // Generate proof
        const proofResult = await generateAddLiquidityProof({
            root: state.merkleTree.getRoot(),
            inputUtxos,
            outputUtxo,
            poolState: {
                reserveA: reserveA.toString(),
                reserveB: reserveB.toString(),
                poolPubkey: CONFIG.poolAccounts.poolAccount,
                poolBlinding: randomFieldElement(),
            },
            newPoolState: {
                reserveA: (BigInt(reserveA) + BigInt(amountA)).toString(),
                reserveB: (BigInt(reserveB) + BigInt(amountB)).toString(),
                poolBlinding: randomFieldElement(),
            },
            lpState: {
                totalLpSupply: totalLpSupply.toString(),
                lpPoolPubkey: CONFIG.poolAccounts.poolAccount,
                lpBlinding: randomFieldElement(),
            },
            newLpState: {
                totalLpSupply: (BigInt(totalLpSupply) + BigInt(lpAmount)).toString(),
                lpBlinding: randomFieldElement(),
            },
            extDataHash: '0',
        });

        updateTxStatus('Submitting to relayer...');

        const response = await fetch(`${CONFIG.relayerUrl}/add-liquidity`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                proof: proofResult.proof,
                publicSignals: proofResult.publicSignals,
                nullifiers: proofResult.inputNullifiers,
                outputCommitment: proofResult.outputCommitment,
                newPoolStateHash: proofResult.newPoolStateHash,
                newLpStateHash: proofResult.newLpStateHash,
            }),
        });

        const result = await response.json();

        if (result.success) {
            // Update UTXOs
            for (const utxo of selectionA.utxos) {
                await state.utxoStorage.markSpent(utxo.commitment, proofResult.inputNullifiers[0]);
            }
            for (const utxo of selectionB.utxos) {
                await state.utxoStorage.markSpent(utxo.commitment, proofResult.inputNullifiers[1]);
            }

            await state.utxoStorage.addUtxo({
                commitment: proofResult.outputCommitment,
                amount: lpAmount.toString(),
                assetId: ASSET_LP,
                blinding: outputUtxo.blinding,
                leafIndex: state.merkleTree.getLeafCount(),
            });

            updatePortfolio();
            showTxSuccess(result.signature, result.explorer);
        } else {
            showTxError(result.error);
        }
    } catch (err) {
        console.error('Add liquidity failed:', err);
        showTxError(err.message);
    }
}

async function executeRemoveLiquidity() {
    const lpAmount = parseFloat(document.getElementById('remove-lp').value);

    if (!lpAmount) {
        alert('Please enter LP amount');
        return;
    }

    if (!state.utxoStorage) {
        alert('Please connect wallet first');
        return;
    }

    showTxModal('Selecting LP UTXOs...');

    try {
        const lpAmountRaw = Math.floor(lpAmount * 1e6);

        // Select LP UTXOs
        const selection = state.utxoStorage.selectUtxos(ASSET_LP, lpAmountRaw);

        if (selection.utxos.length === 0) {
            throw new Error('Insufficient LP balance');
        }

        updateTxStatus('Calculating withdrawal amounts...');

        // Calculate amounts to receive
        const { reserveA, reserveB, totalLpSupply } = state.poolState;
        const share = BigInt(lpAmountRaw) * BigInt(1e18) / BigInt(totalLpSupply);
        const amountA = (BigInt(reserveA) * share / BigInt(1e18)).toString();
        const amountB = (BigInt(reserveB) * share / BigInt(1e18)).toString();

        const inputUtxo = {
            lpAmount: selection.utxos[0].amount,
            privateKey: state.privateKey,
            blinding: selection.utxos[0].blinding,
            pathElements: state.merkleTree.getProof(selection.utxos[0].leafIndex).pathElements,
            pathIndices: state.merkleTree.getProof(selection.utxos[0].leafIndex).pathIndices,
        };

        const outputUtxos = [
            {
                amount: amountA,
                pubkey: state.zkPubkey,
                blinding: randomFieldElement(),
            },
            {
                amount: amountB,
                pubkey: state.zkPubkey,
                blinding: randomFieldElement(),
            },
        ];

        updateTxStatus('Generating ZK proof... (this may take 20-40 seconds)');

        const proofResult = await generateRemoveLiquidityProof({
            root: state.merkleTree.getRoot(),
            inputUtxo,
            outputUtxos,
            poolState: {
                reserveA: reserveA.toString(),
                reserveB: reserveB.toString(),
                poolPubkey: CONFIG.poolAccounts.poolAccount,
                poolBlinding: randomFieldElement(),
            },
            newPoolState: {
                reserveA: (BigInt(reserveA) - BigInt(amountA)).toString(),
                reserveB: (BigInt(reserveB) - BigInt(amountB)).toString(),
                poolBlinding: randomFieldElement(),
            },
            lpState: {
                totalLpSupply: totalLpSupply.toString(),
                lpPoolPubkey: CONFIG.poolAccounts.poolAccount,
                lpBlinding: randomFieldElement(),
            },
            newLpState: {
                totalLpSupply: (BigInt(totalLpSupply) - BigInt(lpAmountRaw)).toString(),
                lpBlinding: randomFieldElement(),
            },
            extDataHash: '0',
        });

        updateTxStatus('Submitting to relayer...');

        const response = await fetch(`${CONFIG.relayerUrl}/remove-liquidity`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                proof: proofResult.proof,
                publicSignals: proofResult.publicSignals,
                nullifier: proofResult.inputNullifier,
                outputCommitments: proofResult.outputCommitments,
                newPoolStateHash: proofResult.newPoolStateHash,
                newLpStateHash: proofResult.newLpStateHash,
            }),
        });

        const result = await response.json();

        if (result.success) {
            await state.utxoStorage.markSpent(selection.utxos[0].commitment, proofResult.inputNullifier);

            await state.utxoStorage.addUtxo({
                commitment: proofResult.outputCommitments[0],
                amount: amountA,
                assetId: ASSET_SOL,
                blinding: outputUtxos[0].blinding,
                leafIndex: state.merkleTree.getLeafCount(),
            });

            await state.utxoStorage.addUtxo({
                commitment: proofResult.outputCommitments[1],
                amount: amountB,
                assetId: ASSET_USDC,
                blinding: outputUtxos[1].blinding,
                leafIndex: state.merkleTree.getLeafCount() + 1,
            });

            updatePortfolio();
            showTxSuccess(result.signature, result.explorer);
        } else {
            showTxError(result.error);
        }
    } catch (err) {
        console.error('Remove liquidity failed:', err);
        showTxError(err.message);
    }
}

// ============================================================================
// Portfolio Functions
// ============================================================================

function initPortfolio() {
    document.getElementById('deposit-btn').addEventListener('click', showDepositModal);
    document.getElementById('withdraw-btn').addEventListener('click', showWithdrawModal);
    document.getElementById('confirm-deposit').addEventListener('click', executeDeposit);
    document.getElementById('confirm-withdraw').addEventListener('click', executeWithdraw);

    // Add recovery button listeners
    const clearRebuildBtn = document.getElementById('clear-rebuild-btn');
    if (clearRebuildBtn) {
        clearRebuildBtn.addEventListener('click', clearAndRebuildUtxos);
    }

    const recoveryBtn = document.getElementById('recover-utxo-btn');
    if (recoveryBtn) {
        recoveryBtn.addEventListener('click', recoverUtxos);
    }

    const manualRecoveryBtn = document.getElementById('manual-recover-btn');
    if (manualRecoveryBtn) {
        manualRecoveryBtn.addEventListener('click', showManualRecoveryModal);
    }

    const confirmManualRecoveryBtn = document.getElementById('confirm-manual-recovery');
    if (confirmManualRecoveryBtn) {
        confirmManualRecoveryBtn.addEventListener('click', executeManualRecovery);
    }
}

function updatePortfolio() {
    if (!state.utxoStorage) {
        document.getElementById('total-value').textContent = '$0.00';
        document.getElementById('utxo-count').textContent = '0';
        return;
    }

    const utxos = state.utxoStorage.getUnspent();
    console.log('Portfolio UTXOs:', utxos);
    console.log('All UTXOs (including spent):', state.utxoStorage.getAll());

    // Calculate totals
    let totalSol = 0n;
    let totalUsdc = 0n;
    let totalLp = 0n;

    utxos.forEach(utxo => {
        const amount = BigInt(utxo.amount);
        if (utxo.assetId === ASSET_SOL) totalSol += amount;
        if (utxo.assetId === ASSET_USDC) totalUsdc += amount;
        if (utxo.assetId === ASSET_LP) totalLp += amount;
    });

    // Update UI
    const solPrice = 150; // Mock price
    const totalValue = (Number(totalSol) / 1e9) * solPrice + (Number(totalUsdc) / 1e6);

    document.getElementById('total-value').textContent = '$' + totalValue.toFixed(2);
    document.getElementById('utxo-count').textContent = utxos.length.toString();

    // Update asset list
    const listContent = document.getElementById('asset-list-content');
    if (utxos.length === 0) {
        listContent.innerHTML = '<p class="empty-state">No private assets. Deposit to get started!</p>';
    } else {
        listContent.innerHTML = `
            <div class="asset-item">SOL: ${(Number(totalSol) / 1e9).toFixed(4)}</div>
            <div class="asset-item">USDC: ${(Number(totalUsdc) / 1e6).toFixed(2)}</div>
            ${totalLp > 0n ? `<div class="asset-item">LP: ${(Number(totalLp) / 1e6).toFixed(2)}</div>` : ''}
        `;
    }

    // Update balances in other tabs
    document.getElementById('from-balance').textContent = (Number(totalSol) / 1e9).toFixed(4);
    document.getElementById('lp-balance').textContent = (Number(totalLp) / 1e6).toFixed(2);
}

/**
 * Clear local UTXOs and rebuild from chain
 * Use this when local data is out of sync with on-chain state
 */
async function clearAndRebuildUtxos() {
    if (!state.wallet || !state.privateKey || !state.zkPubkey) {
        alert('Please connect wallet first');
        return;
    }

    if (!confirm('This will clear your local UTXO data and try to recover from the blockchain. Continue?')) {
        return;
    }

    showTxModal('Clearing local data...');

    try {
        // Clear local UTXO storage
        await state.utxoStorage.clear();
        console.log('Cleared local UTXO storage');

        // Reset deposit nonce to 0 to scan from beginning
        resetDepositNonce();
        console.log('Reset deposit nonce to 0');

        updateTxStatus('Rebuilding from chain...');

        // Now run the recovery function
        await recoverUtxos();

    } catch (err) {
        console.error('Clear and rebuild failed:', err);
        showTxError(err.message);
    }
}

/**
 * UTXO Recovery Function
 * Scans on-chain Merkle tree commitments and tries to find user's UTXOs
 * using deterministic blinding derivation
 */
async function recoverUtxos() {
    if (!state.wallet || !state.privateKey || !state.zkPubkey) {
        alert('Please connect wallet first');
        return;
    }

    showTxModal('Starting UTXO recovery...');

    try {
        // Step 1: Sync Merkle tree from chain to get all commitments
        updateTxStatus('Syncing Merkle tree from chain...');
        const merkleTree = await syncMerkleTreeFromChain(
            CONFIG.rpcUrl,
            CONFIG.poolAccounts.merkleAccount
        );
        state.merkleTree = merkleTree;

        const totalLeaves = merkleTree.getLeafCount();
        console.log(`Found ${totalLeaves} commitments on chain`);

        if (totalLeaves === 0) {
            showTxError('No commitments found on chain');
            return;
        }

        // Step 2: Get nullifier set to check which UTXOs are spent
        updateTxStatus('Checking nullifier set...');
        const spentNullifiers = await fetchSpentNullifiers();

        // Step 3: Scan each commitment
        updateTxStatus(`Scanning ${totalLeaves} commitments...`);
        const recoveredUtxos = [];

        // Common deposit amounts to try (in raw units)
        // SOL: 0.001, 0.01, 0.1, 0.5, 1, 2, 5, 10 SOL
        const solAmounts = [
            1000000, 10000000, 100000000, 500000000,
            1000000000, 2000000000, 5000000000, 10000000000,
        ];
        // USDC: 0.01, 0.1, 1, 5, 10, 50, 100, 500, 1000 USDC
        const usdcAmounts = [
            10000, 100000, 1000000, 5000000, 10000000,
            50000000, 100000000, 500000000, 1000000000,
        ];

        for (let leafIndex = 0; leafIndex < totalLeaves; leafIndex++) {
            const commitment = merkleTree.leaves[leafIndex];
            updateTxStatus(`Scanning commitment ${leafIndex + 1}/${totalLeaves}...`);

            // Check if already in our storage
            const existingUtxo = state.utxoStorage.getAll().find(u => u.commitment === commitment);
            if (existingUtxo) {
                console.log(`Commitment ${leafIndex} already in storage`);
                continue;
            }

            // Try SOL asset (assetId = 0)
            for (const amount of solAmounts) {
                const result = await scanForUtxo(commitment, state.privateKey, state.zkPubkey, amount, ASSET_SOL, 100);
                if (result) {
                    console.log(`Recovered SOL UTXO: amount=${amount}, nonce=${result.nonce}`);
                    recoveredUtxos.push({
                        commitment,
                        amount: amount.toString(),
                        assetId: ASSET_SOL,
                        blinding: result.blinding,
                        leafIndex,
                        depositNonce: result.nonce,
                        recovered: true,
                    });
                    break;
                }
            }

            // Try USDC asset (assetId = 1)
            const existingSol = recoveredUtxos.find(u => u.commitment === commitment);
            if (!existingSol) {
                for (const amount of usdcAmounts) {
                    const result = await scanForUtxo(commitment, state.privateKey, state.zkPubkey, amount, ASSET_USDC, 100);
                    if (result) {
                        console.log(`Recovered USDC UTXO: amount=${amount}, nonce=${result.nonce}`);
                        recoveredUtxos.push({
                            commitment,
                            amount: amount.toString(),
                            assetId: ASSET_USDC,
                            blinding: result.blinding,
                            leafIndex,
                            depositNonce: result.nonce,
                            recovered: true,
                        });
                        break;
                    }
                }
            }
        }

        // Step 4: Add recovered UTXOs to storage
        updateTxStatus(`Recovered ${recoveredUtxos.length} UTXOs, saving...`);

        for (const utxo of recoveredUtxos) {
            // Check if UTXO is spent by checking nullifier
            const nullifier = await computeNullifier(
                utxo.commitment,
                state.privateKey,
                utxo.leafIndex
            );

            const isSpent = spentNullifiers.includes(nullifier);

            if (!isSpent) {
                await state.utxoStorage.addUtxo(utxo);
                console.log(`Added recovered UTXO: ${utxo.assetId === ASSET_SOL ? 'SOL' : 'USDC'} ${utxo.amount}`);
            } else {
                console.log(`Skipping spent UTXO: ${utxo.commitment.slice(0, 10)}...`);
            }
        }

        // Update nonce to max found + 1
        const maxNonce = Math.max(0, ...recoveredUtxos.map(u => u.depositNonce));
        const currentNonce = getDepositNonce();
        if (maxNonce >= currentNonce) {
            localStorage.setItem('privacy-amm-deposit-nonce', (maxNonce + 1).toString());
            console.log(`Updated deposit nonce to ${maxNonce + 1}`);
        }

        // Refresh UI
        updatePortfolio();

        if (recoveredUtxos.length > 0) {
            showTxSuccess(null, null);
            document.getElementById('tx-status-text').textContent =
                `Successfully recovered ${recoveredUtxos.length} UTXOs!`;
        } else {
            showTxError('No recoverable UTXOs found. This could mean:\n' +
                '1. No deposits were made from this wallet\n' +
                '2. All UTXOs have already been spent\n' +
                '3. Deposits used random blinding (older version)');
        }

    } catch (err) {
        console.error('Recovery failed:', err);
        showTxError('Recovery failed: ' + err.message);
    }
}

/**
 * Fetch spent nullifiers from chain
 */
async function fetchSpentNullifiers() {
    try {
        const { Connection, PublicKey } = window.solanaWeb3 || await loadSolanaWeb3();
        const connection = new Connection(CONFIG.rpcUrl, 'confirmed');
        const nullifierPubkey = new PublicKey(CONFIG.poolAccounts.nullifierAccount);

        const accountInfo = await connection.getAccountInfo(nullifierPubkey);
        if (!accountInfo || !accountInfo.data) {
            return [];
        }

        // Parse nullifier set - it's a bitmap, so we need to extract which nullifiers are set
        // For now return empty array - full implementation would parse the bitmap
        // The on-chain nullifier is stored as Poseidon hash values
        console.log('Nullifier account size:', accountInfo.data.length);

        return [];
    } catch (err) {
        console.error('Failed to fetch nullifiers:', err);
        return [];
    }
}

async function executeDeposit() {
    const amount = parseFloat(document.getElementById('deposit-amount').value);
    const token = document.getElementById('deposit-token').value;

    if (!amount) {
        alert('Please enter an amount');
        return;
    }

    if (!state.utxoStorage || !state.wallet) {
        alert('Please connect wallet first');
        return;
    }

    hideAllModals();
    showTxModal('Computing commitment...');

    try {
        const assetId = token === 'SOL' ? ASSET_SOL : ASSET_USDC;
        const amountRaw = token === 'SOL' ? Math.floor(amount * 1e9) : Math.floor(amount * 1e6);

        // Use deterministic blinding for recovery support
        // blinding = Poseidon(privateKey, nonce, amount, assetId)
        const depositNonce = getDepositNonce();
        const blinding = await deriveBlinding(state.privateKey, depositNonce, amountRaw, assetId);

        console.log(`Deposit nonce: ${depositNonce}, blinding derived deterministically`);

        // Compute commitment
        const commitment = await computeCommitment(
            amountRaw.toString(),
            assetId.toString(),
            state.zkPubkey,
            blinding
        );

        updateTxStatus('Building transaction...');

        // Build instruction data for deposit
        const instructionData = buildDepositInstructionData(commitment, amountRaw, assetId);

        // Build transaction using @solana/web3.js (loaded via CDN)
        const { Connection, PublicKey, Transaction, TransactionInstruction } = window.solanaWeb3 || await loadSolanaWeb3();

        const connection = new Connection(CONFIG.rpcUrl, 'confirmed');
        const userPubkey = new PublicKey(state.publicKey);
        const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

        // Get token accounts based on deposit type
        const tokenMint = token === 'SOL'
            ? new PublicKey(CONFIG.tokenAccounts.wsolMint)
            : new PublicKey(CONFIG.tokenAccounts.usdcMint);
        const poolVault = token === 'SOL'
            ? new PublicKey(CONFIG.tokenAccounts.poolWsolVault)
            : new PublicKey(CONFIG.tokenAccounts.poolUsdcVault);

        // Get user's ATA
        const userTokenAccount = await getAssociatedTokenAddress(userPubkey, tokenMint);

        updateTxStatus('Checking token account...');

        // Verify user has the token account and sufficient balance
        try {
            const tokenInfo = await connection.getTokenAccountBalance(userTokenAccount);
            const balance = parseFloat(tokenInfo.value.uiAmountString) || 0;
            const requiredBalance = token === 'SOL' ? amount : amount;
            if (balance < requiredBalance) {
                throw new Error(`Insufficient ${token === 'SOL' ? 'wSOL' : 'tUSDC'} balance. Have: ${balance}, Need: ${requiredBalance}`);
            }
        } catch (e) {
            if (e.message.includes('Insufficient')) throw e;
            throw new Error(`You need a ${token === 'SOL' ? 'wSOL' : 'tUSDC'} token account. Please wrap SOL or get tUSDC first.`);
        }

        // Get recent blockhash
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

        // Create transaction
        const transaction = new Transaction({
            recentBlockhash: blockhash,
            feePayer: userPubkey,
        });

        // Add deposit instruction with 6 accounts (includes token transfer)
        // Account layout:
        // [0] depositor: User depositing funds (signer)
        // [1] pool_account: Pool state
        // [2] merkle_account: Merkle tree state
        // [3] user_token_account: User's token account
        // [4] pool_vault: Pool's token vault
        // [5] token_program: SPL Token program
        const depositInstruction = new TransactionInstruction({
            programId: new PublicKey(CONFIG.programId),
            keys: [
                { pubkey: userPubkey, isSigner: true, isWritable: true },
                { pubkey: new PublicKey(CONFIG.poolAccounts.poolAccount), isSigner: false, isWritable: true },
                { pubkey: new PublicKey(CONFIG.poolAccounts.merkleAccount), isSigner: false, isWritable: true },
                { pubkey: userTokenAccount, isSigner: false, isWritable: true },
                { pubkey: poolVault, isSigner: false, isWritable: true },
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            ],
            data: Buffer.from(instructionData),
        });
        transaction.add(depositInstruction);

        updateTxStatus('Please approve in wallet...');

        // Sign and send transaction
        const signed = await state.wallet.signTransaction(transaction);
        const signature = await connection.sendRawTransaction(signed.serialize());

        updateTxStatus('Confirming transaction...');

        // Wait for confirmation
        await connection.confirmTransaction({
            signature,
            blockhash,
            lastValidBlockHeight,
        });

        // Add UTXO to local storage (with nonce for reference)
        await state.utxoStorage.addUtxo({
            commitment,
            amount: amountRaw.toString(),
            assetId,
            blinding,
            leafIndex: state.merkleTree.getLeafCount(),
            depositNonce,  // Store nonce for recovery verification
        });

        // Increment the deposit nonce for next deposit
        incrementDepositNonce();

        // Update local Merkle tree
        await state.merkleTree.insert(commitment);

        // Refresh balances
        updatePortfolio();
        await fetchTokenBalances();

        showTxSuccess(signature, `https://explorer.solana.com/tx/${signature}?cluster=testnet`);

    } catch (err) {
        console.error('Deposit failed:', err);
        showTxError(err.message);
    }
}

// Build deposit instruction data
function buildDepositInstructionData(commitment, amount, assetType) {
    // Layout: [instruction_id: u8, commitment: [32]u8, amount: u64, asset_type: u8]
    const data = new Uint8Array(1 + 32 + 8 + 1);
    let offset = 0;

    // Instruction ID: 1 = Deposit
    data[offset++] = 1;

    // Commitment (32 bytes, little-endian - matches Solana/Zig convention)
    let commitmentBigInt = BigInt(commitment);
    for (let i = 0; i < 32; i++) {
        data[offset++] = Number(commitmentBigInt & 0xFFn);
        commitmentBigInt >>= 8n;
    }

    // Amount (8 bytes, little-endian)
    let amountBigInt = BigInt(amount);
    for (let i = 0; i < 8; i++) {
        data[offset++] = Number(amountBigInt & 0xFFn);
        amountBigInt >>= 8n;
    }

    // Asset type (1 byte)
    data[offset++] = assetType;

    return data;
}

// Load Solana Web3.js dynamically
async function loadSolanaWeb3() {
    if (window.solanaWeb3) return window.solanaWeb3;

    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/@solana/web3.js@latest/lib/index.iife.min.js';
        script.onload = () => resolve(window.solanaWeb3);
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

async function executeWithdraw() {
    const amount = parseFloat(document.getElementById('withdraw-amount').value);
    const recipientWallet = document.getElementById('withdraw-recipient').value;
    const token = document.getElementById('withdraw-token')?.value || 'SOL';

    if (!amount || !recipientWallet) {
        alert('Please enter amount and recipient');
        return;
    }

    if (!state.utxoStorage) {
        alert('Please connect wallet first');
        return;
    }

    hideAllModals();
    showTxModal('Selecting UTXOs...');

    try {
        const assetId = token === 'SOL' ? ASSET_SOL : ASSET_USDC;
        const amountRaw = token === 'SOL' ? Math.floor(amount * 1e9) : Math.floor(amount * 1e6);

        // Select UTXOs
        const selection = state.utxoStorage.selectUtxos(assetId, amountRaw);

        if (selection.utxos.length === 0) {
            throw new Error('Insufficient private balance');
        }

        const utxo = selection.utxos[0];

        // Compute nullifier
        const commitment = await computeCommitment(
            utxo.amount,
            assetId.toString(),
            state.zkPubkey,
            utxo.blinding
        );

        const nullifier = await computeNullifier(
            commitment,
            state.privateKey,
            utxo.leafIndex.toString()
        );

        updateTxStatus('Getting recipient token account...');

        // Get recipient's ATA (Associated Token Account)
        const { PublicKey } = window.solanaWeb3 || await loadSolanaWeb3();
        const recipientPubkey = new PublicKey(recipientWallet);
        const tokenMint = token === 'SOL'
            ? new PublicKey(CONFIG.tokenAccounts.wsolMint)
            : new PublicKey(CONFIG.tokenAccounts.usdcMint);
        const recipientTokenAccount = await getAssociatedTokenAddress(recipientPubkey, tokenMint);

        updateTxStatus('Submitting withdrawal...');

        const response = await fetch(`${CONFIG.relayerUrl}/withdraw`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                proof: {}, // Withdraw doesn't need full ZK proof for basic version
                publicSignals: [],
                nullifier,
                recipient: recipientTokenAccount.toBase58(),  // Send ATA address, not wallet
                amount: amountRaw,
                assetType: assetId,  // 0 = SOL/wSOL, 1 = USDC/tUSDC
            }),
        });

        const result = await response.json();

        if (result.success) {
            await state.utxoStorage.markSpent(utxo.commitment, nullifier);
            updatePortfolio();
            await fetchTokenBalances();
            showTxSuccess(result.signature, result.explorer);
        } else {
            showTxError(result.error || 'Withdrawal failed');
        }
    } catch (err) {
        console.error('Withdraw failed:', err);
        showTxError(err.message);
    }
}

// ============================================================================
// Modal Functions
// ============================================================================

function initModals() {
    // Close modal on overlay click
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
        if (e.target.id === 'modal-overlay') {
            hideAllModals();
        }
    });

    // Close buttons
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', hideAllModals);
    });
}

function showTxModal(status) {
    document.getElementById('modal-overlay').classList.remove('hidden');
    document.getElementById('tx-modal').classList.remove('hidden');
    document.getElementById('tx-status-text').textContent = status;
    document.getElementById('tx-spinner').style.display = 'block';
    document.getElementById('tx-success').classList.add('hidden');
    document.getElementById('tx-error').classList.add('hidden');
    document.querySelector('.tx-status').classList.remove('hidden');
}

function updateTxStatus(status) {
    document.getElementById('tx-status-text').textContent = status;
}

function showTxSuccess(signature, explorerUrl) {
    document.querySelector('.tx-status').classList.add('hidden');
    document.getElementById('tx-success').classList.remove('hidden');
    document.getElementById('tx-explorer-link').href = explorerUrl || `https://explorer.solana.com/tx/${signature}?cluster=testnet`;
}

function showTxError(message) {
    document.querySelector('.tx-status').classList.add('hidden');
    document.getElementById('tx-error').classList.remove('hidden');
    document.getElementById('tx-error-text').textContent = message;
}

function showDepositModal() {
    document.getElementById('modal-overlay').classList.remove('hidden');
    document.getElementById('deposit-modal').classList.remove('hidden');
}

function showWithdrawModal() {
    document.getElementById('modal-overlay').classList.remove('hidden');
    document.getElementById('withdraw-modal').classList.remove('hidden');
}

function showManualRecoveryModal() {
    document.getElementById('modal-overlay').classList.remove('hidden');
    document.getElementById('manual-recovery-modal').classList.remove('hidden');
}

/**
 * Execute manual UTXO recovery with specific amount
 */
async function executeManualRecovery() {
    const amount = parseFloat(document.getElementById('manual-recovery-amount').value);
    const token = document.getElementById('manual-recovery-token').value;

    if (!amount) {
        alert('Please enter an amount');
        return;
    }

    if (!state.wallet || !state.privateKey || !state.zkPubkey) {
        alert('Please connect wallet first');
        return;
    }

    hideAllModals();
    showTxModal('Starting manual recovery...');

    try {
        const assetId = token === 'SOL' ? ASSET_SOL : ASSET_USDC;
        const amountRaw = token === 'SOL' ? Math.floor(amount * 1e9) : Math.floor(amount * 1e6);

        // Sync Merkle tree from chain
        updateTxStatus('Syncing Merkle tree...');
        const merkleTree = await syncMerkleTreeFromChain(
            CONFIG.rpcUrl,
            CONFIG.poolAccounts.merkleAccount
        );
        state.merkleTree = merkleTree;

        const totalLeaves = merkleTree.getLeafCount();
        console.log(`Found ${totalLeaves} commitments, scanning for amount ${amountRaw}...`);

        if (totalLeaves === 0) {
            showTxError('No commitments found on chain');
            return;
        }

        // Scan each commitment
        let foundCount = 0;
        for (let leafIndex = 0; leafIndex < totalLeaves; leafIndex++) {
            const commitment = merkleTree.leaves[leafIndex];
            updateTxStatus(`Scanning commitment ${leafIndex + 1}/${totalLeaves}...`);

            // Check if already in our storage
            const existingUtxo = state.utxoStorage.getAll().find(u => u.commitment === commitment);
            if (existingUtxo) {
                console.log(`Commitment ${leafIndex} already in storage`);
                continue;
            }

            // Try to find UTXO with specified amount
            const result = await scanForUtxo(commitment, state.privateKey, state.zkPubkey, amountRaw, assetId, 200);
            if (result) {
                console.log(`Found UTXO! nonce=${result.nonce}`);

                await state.utxoStorage.addUtxo({
                    commitment,
                    amount: amountRaw.toString(),
                    assetId,
                    blinding: result.blinding,
                    leafIndex,
                    depositNonce: result.nonce,
                    recovered: true,
                });

                // Update nonce
                const currentNonce = getDepositNonce();
                if (result.nonce >= currentNonce) {
                    localStorage.setItem('privacy-amm-deposit-nonce', (result.nonce + 1).toString());
                }

                foundCount++;
            }
        }

        // Refresh UI
        updatePortfolio();

        if (foundCount > 0) {
            showTxSuccess(null, null);
            document.getElementById('tx-status-text').textContent =
                `Found ${foundCount} UTXO(s) with amount ${amount} ${token}!`;
        } else {
            showTxError(`No UTXO found with amount ${amount} ${token}.\n` +
                'Make sure the amount is exactly what you deposited.');
        }

    } catch (err) {
        console.error('Manual recovery failed:', err);
        showTxError('Recovery failed: ' + err.message);
    }
}

function hideAllModals() {
    document.getElementById('modal-overlay').classList.add('hidden');
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
}

// ============================================================================
// Data Functions
// ============================================================================

async function loadPoolState() {
    try {
        // First try to load directly from chain for accurate data
        const { Connection, PublicKey } = window.solanaWeb3 || await loadSolanaWeb3();
        const connection = new Connection(CONFIG.rpcUrl, 'confirmed');

        const poolPubkey = new PublicKey(CONFIG.poolAccounts.poolAccount);
        const accountInfo = await connection.getAccountInfo(poolPubkey);

        if (accountInfo && accountInfo.data.length >= 90) {
            // Convert to Uint8Array if needed
            const rawData = accountInfo.data instanceof Uint8Array
                ? accountInfo.data
                : new Uint8Array(accountInfo.data);

            // Parse PoolState from raw bytes using DataView (little-endian)
            // offset 66: reserve_a (u64 LE)
            // offset 74: reserve_b (u64 LE)
            // offset 82: total_lp (u64 LE)
            const dataView = new DataView(rawData.buffer, rawData.byteOffset, rawData.byteLength);

            // Read u64 LE (split into low and high 32-bit parts)
            const readU64LE = (offset) => {
                const low = dataView.getUint32(offset, true);
                const high = dataView.getUint32(offset + 4, true);
                return low + high * 0x100000000;
            };

            const reserveA = readU64LE(66);
            const reserveB = readU64LE(74);
            const totalLp = readU64LE(82);

            state.poolState = {
                reserveA: reserveA,
                reserveB: reserveB,
                totalLpSupply: totalLp,
            };

            console.log('Pool state from chain:', {
                reserveA: (reserveA / 1e9).toFixed(4) + ' SOL',
                reserveB: (reserveB / 1e6).toFixed(2) + ' USDC',
                totalLp: totalLp,
            });
        } else {
            throw new Error('Invalid pool account data');
        }

        // Update rate display
        if (state.poolState.reserveA > 0) {
            const rate = state.poolState.reserveB / state.poolState.reserveA * 1e3;
            document.getElementById('swap-rate').textContent = `1 SOL = ${rate.toFixed(2)} USDC`;
        }

    } catch (err) {
        console.error('Failed to load pool state from chain:', err);
        // Fallback to relayer
        try {
            const response = await fetch(`${CONFIG.relayerUrl}/pool`);
            const data = await response.json();
            state.poolState = {
                reserveA: parseFloat(data.reserveA),
                reserveB: parseFloat(data.reserveB),
                totalLpSupply: parseFloat(data.totalLpSupply),
            };
        } catch (e) {
            console.error('Relayer also failed:', e);
            // Last resort: use small mock data
            state.poolState = {
                reserveA: 1000000000, // 1 SOL
                reserveB: 100000000,  // 100 USDC
                totalLpSupply: 316227766,
            };
        }
    }
}

// ============================================================================
// Utility Functions
// ============================================================================

function shortenAddress(address) {
    if (!address) return '';
    return address.slice(0, 4) + '...' + address.slice(-4);
}
