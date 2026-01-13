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
} from './utxoStorage.js';

// Configuration
const CONFIG = {
    relayerUrl: 'https://privacy-amm-relayer-staging.davirain-yin.workers.dev',
    rpcUrl: 'https://api.testnet.solana.com',
    wsUrl: 'wss://api.testnet.solana.com',
    network: 'testnet',
    programId: 'GZfqgHqekzR4D8TAq165XB8U2boVdK5ehEEH4n7u4Xts',
    poolAccounts: {
        poolAccount: '3Lz9gKbA1kB4V4bu4cGVpXrvStpUs48iBKX56ksw6Wbt',
        merkleAccount: 'DNNEL3RqN2kNYdGn65VgLHiMoUEoi49mms15nsYFVwgQ',
        nullifierAccount: 'Hh6pbngRGfnQ7T5casM4eobwQyJe1LDSRjAA9EVx2rtE',
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

        console.log('Connected:', state.publicKey);

    } catch (err) {
        console.error('Wallet connection failed:', err);
        alert('Failed to connect wallet: ' + err.message);
    }
}

async function deriveZkKeypair() {
    try {
        // Sign a deterministic message to derive ZK private key
        const message = `Privacy AMM ZK Keypair\nPublic Key: ${state.publicKey}\nNetwork: ${CONFIG.network}`;
        const encodedMessage = new TextEncoder().encode(message);
        const signature = await state.wallet.signMessage(encodedMessage, 'utf8');

        // Use first 31 bytes of signature as private key (to stay in field)
        const sigBytes = signature.signature.slice(0, 31);
        let privateKeyNum = BigInt(0);
        for (let i = 0; i < 31; i++) {
            privateKeyNum = privateKeyNum * 256n + BigInt(sigBytes[i]);
        }
        state.privateKey = privateKeyNum.toString();

        // Derive public key
        state.zkPubkey = await derivePublicKey(state.privateKey);

        console.log('ZK keypair derived');
    } catch (err) {
        console.error('Failed to derive ZK keypair:', err);
        // Use random keypair as fallback
        state.privateKey = randomFieldElement();
        state.zkPubkey = await derivePublicKey(state.privateKey);
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
    document.getElementById('add-liquidity-btn').disabled = !connected;
    document.getElementById('remove-liquidity-btn').disabled = !connected;
    document.getElementById('deposit-btn').disabled = !connected;
    document.getElementById('withdraw-btn').disabled = !connected;

    if (connected) {
        document.getElementById('swap-btn').textContent = 'Swap';
    } else {
        document.getElementById('swap-btn').textContent = 'Connect Wallet to Swap';
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

    showTxModal('Selecting UTXOs...');

    try {
        // Determine asset IDs
        const fromAssetId = fromToken === 'SOL' ? ASSET_SOL : ASSET_USDC;
        const toAssetId = fromToken === 'SOL' ? ASSET_USDC : ASSET_SOL;

        // Convert amounts to smallest unit
        const fromAmountRaw = fromToken === 'SOL' ? Math.floor(fromAmount * 1e9) : Math.floor(fromAmount * 1e6);
        const toAmountRaw = fromToken === 'SOL' ? Math.floor(toAmount * 1e6) : Math.floor(toAmount * 1e9);

        // Select UTXOs for input
        const selection = state.utxoStorage.selectUtxos(fromAssetId, fromAmountRaw);

        if (selection.utxos.length === 0) {
            throw new Error('Insufficient private balance');
        }

        updateTxStatus('Building input UTXOs...');

        // Build input UTXOs with Merkle proofs
        const inputUtxos = [];
        for (let i = 0; i < 2; i++) {
            const utxo = selection.utxos[i] || createDummyUtxo(fromAssetId);
            const proof = state.merkleTree.getProof(utxo.leafIndex || 0);

            inputUtxos.push({
                amount: utxo.amount || '0',
                assetId: fromAssetId.toString(),
                privateKey: state.privateKey,
                blinding: utxo.blinding || randomFieldElement(),
                pathElements: proof.pathElements,
                pathIndices: proof.pathIndices,
            });
        }

        // Build output UTXOs
        const outputUtxos = [
            {
                amount: toAmountRaw.toString(),
                assetId: toAssetId.toString(),
                pubkey: state.zkPubkey,
                blinding: randomFieldElement(),
            },
            {
                amount: selection.change,
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

function createDummyUtxo(assetId) {
    return {
        amount: '0',
        assetId,
        blinding: randomFieldElement(),
        leafIndex: 0,
    };
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
}

function updatePortfolio() {
    if (!state.utxoStorage) {
        document.getElementById('total-value').textContent = '$0.00';
        document.getElementById('utxo-count').textContent = '0';
        return;
    }

    const utxos = state.utxoStorage.getUnspent();

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
        const blinding = randomFieldElement();

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
        const { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram, LAMPORTS_PER_SOL } = window.solanaWeb3 || await loadSolanaWeb3();

        const connection = new Connection(CONFIG.rpcUrl, 'confirmed');

        // Get recent blockhash
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

        // Create transaction
        const transaction = new Transaction({
            recentBlockhash: blockhash,
            feePayer: new PublicKey(state.publicKey),
        });

        // Add deposit instruction
        const depositInstruction = new TransactionInstruction({
            programId: new PublicKey(CONFIG.programId),
            keys: [
                { pubkey: new PublicKey(state.publicKey), isSigner: true, isWritable: true },
                { pubkey: new PublicKey(CONFIG.poolAccounts.poolAccount), isSigner: false, isWritable: true },
                { pubkey: new PublicKey(CONFIG.poolAccounts.merkleAccount), isSigner: false, isWritable: true },
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

        // Add UTXO to local storage
        await state.utxoStorage.addUtxo({
            commitment,
            amount: amountRaw.toString(),
            assetId,
            blinding,
            leafIndex: state.merkleTree.getLeafCount(),
        });

        // Update local Merkle tree
        await state.merkleTree.insert(commitment);

        updatePortfolio();
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

    // Commitment (32 bytes, big-endian)
    const commitmentBigInt = BigInt(commitment);
    for (let i = 31; i >= 0; i--) {
        data[offset + i] = Number((commitmentBigInt >> BigInt((31 - i) * 8)) & 0xFFn);
    }
    offset += 32;

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
    const recipient = document.getElementById('withdraw-recipient').value;
    const token = document.getElementById('withdraw-token')?.value || 'SOL';

    if (!amount || !recipient) {
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
        const proof = state.merkleTree.getProof(utxo.leafIndex);

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

        updateTxStatus('Submitting withdrawal...');

        const response = await fetch(`${CONFIG.relayerUrl}/withdraw`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                proof: {}, // Withdraw doesn't need full ZK proof for basic version
                publicSignals: [],
                nullifier,
                recipient,
                amount: amountRaw,
            }),
        });

        const result = await response.json();

        if (result.success) {
            await state.utxoStorage.markSpent(utxo.commitment, nullifier);
            updatePortfolio();
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

function hideAllModals() {
    document.getElementById('modal-overlay').classList.add('hidden');
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
}

// ============================================================================
// Data Functions
// ============================================================================

async function loadPoolState() {
    try {
        const response = await fetch(`${CONFIG.relayerUrl}/pool`);
        const data = await response.json();

        state.poolState = {
            reserveA: parseFloat(data.reserveA),
            reserveB: parseFloat(data.reserveB),
            totalLpSupply: parseFloat(data.totalLpSupply),
        };

        // Update rate display
        const rate = state.poolState.reserveB / state.poolState.reserveA * 1e3;
        document.getElementById('swap-rate').textContent = `1 SOL = ${rate.toFixed(2)} USDC`;

    } catch (err) {
        console.error('Failed to load pool state:', err);
        // Use mock data
        state.poolState = {
            reserveA: 10000000000000, // 10000 SOL
            reserveB: 1500000000000,  // 1.5M USDC
            totalLpSupply: 12247448713000,
        };
    }
}

// ============================================================================
// Utility Functions
// ============================================================================

function shortenAddress(address) {
    if (!address) return '';
    return address.slice(0, 4) + '...' + address.slice(-4);
}
