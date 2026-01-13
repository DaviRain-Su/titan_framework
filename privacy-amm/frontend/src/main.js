/**
 * Privacy AMM Frontend
 * Main application logic
 */

// Configuration
const CONFIG = {
    relayerUrl: 'https://privacy-amm-relayer.workers.dev', // Update after deployment
    network: 'testnet',
    programId: '7DGg2ouvHsZecGDocaY1nu6ZmSDvSq9NsLSHd16ENHbQ',
};

// State
const state = {
    wallet: null,
    publicKey: null,
    privateUtxos: [], // User's private UTXOs (stored locally)
    poolState: null,
};

// ============================================================================
// Initialization
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initWallet();
    initSwap();
    initLiquidity();
    initPortfolio();
    initModals();
    loadPoolState();
    loadLocalUtxos();
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
        // Check for Phantom wallet
        if (!window.solana || !window.solana.isPhantom) {
            alert('Please install Phantom wallet to use this app.\nhttps://phantom.app/');
            return;
        }

        const response = await window.solana.connect();
        state.publicKey = response.publicKey.toString();
        state.wallet = window.solana;

        updateWalletUI(true);
        updateButtonStates(true);

        console.log('Connected:', state.publicKey);

    } catch (err) {
        console.error('Wallet connection failed:', err);
        alert('Failed to connect wallet: ' + err.message);
    }
}

function disconnectWallet() {
    if (state.wallet) {
        state.wallet.disconnect();
    }
    state.wallet = null;
    state.publicKey = null;

    updateWalletUI(false);
    updateButtonStates(false);
}

function checkWalletConnection() {
    if (window.solana && window.solana.isPhantom && window.solana.isConnected) {
        state.wallet = window.solana;
        state.publicKey = window.solana.publicKey?.toString();

        if (state.publicKey) {
            updateWalletUI(true);
            updateButtonStates(true);
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

    showTxModal('Generating ZK Proof...');

    try {
        // In a real implementation, we would:
        // 1. Select UTXOs from user's private balance
        // 2. Generate ZK proof using snarkjs
        // 3. Submit to relayer

        // For demo, simulate the process
        await simulateDelay(2000);
        updateTxStatus('Submitting transaction...');

        await simulateDelay(1500);

        // Call relayer
        const response = await fetch(`${CONFIG.relayerUrl}/swap`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                proof: { /* mock proof */ },
                publicSignals: [],
                nullifiers: ['0x123', '0x456'],
                outputCommitments: ['0x789', '0xabc'],
            }),
        });

        const result = await response.json();

        if (result.success) {
            showTxSuccess(result.signature, result.explorer);
        } else {
            showTxError(result.error || 'Swap failed');
        }

    } catch (err) {
        console.error('Swap failed:', err);
        showTxError(err.message);
    }
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
    showTxModal('Generating ZK Proof for Add Liquidity...');

    try {
        await simulateDelay(2500);
        updateTxStatus('Submitting transaction...');

        await simulateDelay(1500);

        const response = await fetch(`${CONFIG.relayerUrl}/add-liquidity`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                proof: {},
                publicSignals: [],
                nullifiers: ['0x123', '0x456'],
                outputCommitment: '0x789',
            }),
        });

        const result = await response.json();

        if (result.success) {
            showTxSuccess(result.signature, result.explorer);
        } else {
            showTxError(result.error);
        }
    } catch (err) {
        showTxError(err.message);
    }
}

async function executeRemoveLiquidity() {
    showTxModal('Generating ZK Proof for Remove Liquidity...');

    try {
        await simulateDelay(2000);
        updateTxStatus('Submitting transaction...');

        await simulateDelay(1500);

        const response = await fetch(`${CONFIG.relayerUrl}/remove-liquidity`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                proof: {},
                publicSignals: [],
                nullifier: '0x123',
                outputCommitments: ['0x456', '0x789'],
            }),
        });

        const result = await response.json();

        if (result.success) {
            showTxSuccess(result.signature, result.explorer);
        } else {
            showTxError(result.error);
        }
    } catch (err) {
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
    const utxos = state.privateUtxos;

    // Calculate totals
    let totalSol = 0;
    let totalUsdc = 0;
    let totalLp = 0;

    utxos.forEach(utxo => {
        if (utxo.assetId === 0) totalSol += parseFloat(utxo.amount);
        if (utxo.assetId === 1) totalUsdc += parseFloat(utxo.amount);
        if (utxo.assetId === 2) totalLp += parseFloat(utxo.amount);
    });

    // Update UI
    const solPrice = 150; // Mock price
    const totalValue = (totalSol / 1e9) * solPrice + (totalUsdc / 1e6);

    document.getElementById('total-value').textContent = '$' + totalValue.toFixed(2);
    document.getElementById('utxo-count').textContent = utxos.length.toString();

    // Update asset list
    const listContent = document.getElementById('asset-list-content');
    if (utxos.length === 0) {
        listContent.innerHTML = '<p class="empty-state">No private assets. Deposit to get started!</p>';
    } else {
        listContent.innerHTML = `
            <div class="asset-item">SOL: ${(totalSol / 1e9).toFixed(4)}</div>
            <div class="asset-item">USDC: ${(totalUsdc / 1e6).toFixed(2)}</div>
            ${totalLp > 0 ? `<div class="asset-item">LP: ${(totalLp / 1e6).toFixed(2)}</div>` : ''}
        `;
    }

    // Update balances in other tabs
    document.getElementById('from-balance').textContent = (totalSol / 1e9).toFixed(4);
    document.getElementById('lp-balance').textContent = (totalLp / 1e6).toFixed(2);
}

async function executeDeposit() {
    const amount = parseFloat(document.getElementById('deposit-amount').value);
    const token = document.getElementById('deposit-token').value;

    if (!amount) {
        alert('Please enter an amount');
        return;
    }

    hideAllModals();
    showTxModal('Processing deposit...');

    try {
        await simulateDelay(2000);

        const response = await fetch(`${CONFIG.relayerUrl}/deposit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                commitment: '0x' + Math.random().toString(16).slice(2),
                amount: token === 'SOL' ? amount * 1e9 : amount * 1e6,
                assetType: token === 'SOL' ? 0 : 1,
            }),
        });

        const result = await response.json();

        if (result.success) {
            // Add UTXO to local storage
            const utxo = {
                amount: (token === 'SOL' ? amount * 1e9 : amount * 1e6).toString(),
                assetId: token === 'SOL' ? 0 : 1,
                commitment: '0x' + Math.random().toString(16).slice(2),
            };
            state.privateUtxos.push(utxo);
            saveLocalUtxos();
            updatePortfolio();

            showTxSuccess(result.signature, result.explorer);
        } else {
            showTxError(result.error);
        }
    } catch (err) {
        showTxError(err.message);
    }
}

async function executeWithdraw() {
    const amount = parseFloat(document.getElementById('withdraw-amount').value);
    const recipient = document.getElementById('withdraw-recipient').value;

    if (!amount || !recipient) {
        alert('Please enter amount and recipient');
        return;
    }

    hideAllModals();
    showTxModal('Generating ZK Proof for withdrawal...');

    try {
        await simulateDelay(2500);
        updateTxStatus('Submitting transaction...');

        await simulateDelay(1500);

        const response = await fetch(`${CONFIG.relayerUrl}/withdraw`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                proof: {},
                publicSignals: [],
                nullifier: '0x123',
                recipient,
                amount: amount * 1e9,
            }),
        });

        const result = await response.json();

        if (result.success) {
            showTxSuccess(result.signature, result.explorer);
        } else {
            showTxError(result.error);
        }
    } catch (err) {
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
    document.getElementById('tx-explorer-link').href = explorerUrl;
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

function loadLocalUtxos() {
    try {
        const stored = localStorage.getItem('privacy-amm-utxos');
        if (stored) {
            state.privateUtxos = JSON.parse(stored);
        }
    } catch (err) {
        console.error('Failed to load UTXOs:', err);
    }
    updatePortfolio();
}

function saveLocalUtxos() {
    localStorage.setItem('privacy-amm-utxos', JSON.stringify(state.privateUtxos));
}

// ============================================================================
// Utility Functions
// ============================================================================

function shortenAddress(address) {
    if (!address) return '';
    return address.slice(0, 4) + '...' + address.slice(-4);
}

function simulateDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
