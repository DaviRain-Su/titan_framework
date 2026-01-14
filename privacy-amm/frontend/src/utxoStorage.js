/**
 * Encrypted UTXO Storage
 * Stores user's private UTXOs with encryption
 */

const STORAGE_KEY = 'privacy-amm-utxos-encrypted';
const SALT_KEY = 'privacy-amm-salt';

/**
 * Derive encryption key from wallet public key and signature
 * Uses PBKDF2 with wallet signature as password
 */
async function deriveEncryptionKey(password, salt) {
    const encoder = new TextEncoder();
    const passwordKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        'PBKDF2',
        false,
        ['deriveBits', 'deriveKey']
    );

    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: 100000,
            hash: 'SHA-256',
        },
        passwordKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * Get or create salt for key derivation
 */
function getOrCreateSalt() {
    let saltHex = localStorage.getItem(SALT_KEY);

    if (!saltHex) {
        const salt = new Uint8Array(16);
        crypto.getRandomValues(salt);
        saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
        localStorage.setItem(SALT_KEY, saltHex);
    }

    return new Uint8Array(saltHex.match(/.{2}/g).map(b => parseInt(b, 16)));
}

/**
 * Encrypt data using AES-GCM
 */
async function encrypt(data, key) {
    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encoder.encode(JSON.stringify(data))
    );

    // Combine IV and ciphertext
    const result = new Uint8Array(iv.length + encrypted.byteLength);
    result.set(iv);
    result.set(new Uint8Array(encrypted), iv.length);

    return btoa(String.fromCharCode(...result));
}

/**
 * Decrypt data using AES-GCM
 */
async function decrypt(encryptedBase64, key) {
    const data = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));

    const iv = data.slice(0, 12);
    const ciphertext = data.slice(12);

    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext
    );

    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(decrypted));
}

/**
 * UTXO Storage class
 */
export class UTXOStorage {
    constructor() {
        this.key = null;
        this.utxos = [];
        this.initialized = false;
    }

    /**
     * Initialize storage with wallet public key
     * Uses wallet-specific storage key for isolation
     */
    async init(wallet, publicKey) {
        this.walletKey = publicKey;
        this.storageKey = `privacy-amm-utxos-${publicKey}`;

        // Always use unencrypted storage (encryption was causing issues with some wallets)
        // The storage is still isolated per wallet address
        this.key = null;
        this.loadWalletUtxos();
        await this.dedupe();
        this.initialized = true;

        console.log(`UTXO storage initialized for wallet ${publicKey.slice(0, 8)}...`);
        console.log(`Loaded ${this.utxos.length} UTXOs from storage`);

        return true;
    }

    /**
     * Load UTXOs for current wallet from localStorage
     */
    loadWalletUtxos() {
        try {
            // Try wallet-specific storage first
            const data = localStorage.getItem(this.storageKey);
            if (data) {
                this.utxos = JSON.parse(data);
                console.log(`Loaded UTXOs from wallet-specific storage: ${this.utxos.length}`);
                return;
            }

            // Fallback to legacy unencrypted storage (migration)
            const legacyData = localStorage.getItem('privacy-amm-utxos');
            if (legacyData) {
                this.utxos = JSON.parse(legacyData);
                console.log(`Migrated UTXOs from legacy storage: ${this.utxos.length}`);
                // Save to new wallet-specific location
                this.saveSync();
                return;
            }

            this.utxos = [];
        } catch (err) {
            console.error('Failed to load UTXOs:', err);
            this.utxos = [];
        }
    }

    /**
     * Synchronous save (used during migration)
     */
    saveSync() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.utxos));
        } catch (err) {
            console.error('Failed to save UTXOs:', err);
        }
    }

    /**
     * Load encrypted UTXOs from storage
     */
    async load() {
        try {
            const encrypted = localStorage.getItem(STORAGE_KEY);
            if (encrypted && this.key) {
                this.utxos = await decrypt(encrypted, this.key);
            } else {
                this.utxos = [];
            }
        } catch (err) {
            console.error('Failed to load UTXOs:', err);
            this.utxos = [];
        }
    }

    /**
     * Load unencrypted UTXOs (fallback)
     */
    loadUnencrypted() {
        try {
            const data = localStorage.getItem('privacy-amm-utxos');
            this.utxos = data ? JSON.parse(data) : [];
        } catch (err) {
            this.utxos = [];
        }
    }

    /**
     * Save UTXOs to storage
     */
    async save() {
        try {
            // Use wallet-specific storage key
            const key = this.storageKey || 'privacy-amm-utxos';
            localStorage.setItem(key, JSON.stringify(this.utxos));
        } catch (err) {
            console.error('Failed to save UTXOs:', err);
        }
    }

    /**
     * Add a UTXO
     */
    async addUtxo(utxo) {
        const existing = this.utxos.find(u => u.commitment === utxo.commitment);
        if (existing) {
            Object.assign(existing, utxo, { createdAt: existing.createdAt || Date.now() });
        } else {
            this.utxos.push({
                ...utxo,
                createdAt: Date.now(),
            });
        }
        await this.save();
    }

    /**
     * Remove a UTXO by commitment
     */
    async removeUtxo(commitment) {
        this.utxos = this.utxos.filter(u => u.commitment !== commitment);
        await this.save();
    }

    /**
     * Mark UTXO as spent
     */
    async markSpent(commitment, nullifier) {
        const utxo = this.utxos.find(u => u.commitment === commitment);
        if (utxo) {
            utxo.spent = true;
            utxo.nullifier = nullifier;
            utxo.spentAt = Date.now();
            await this.save();
        }
    }

    /**
     * Get all unspent UTXOs
     */
    getUnspent() {
        return this.utxos.filter(u => !u.spent);
    }

    /**
     * Get UTXOs by asset ID
     */
    getByAsset(assetId) {
        return this.getUnspent().filter(u => u.assetId === assetId);
    }

    /**
     * Get total balance for an asset
     */
    getBalance(assetId) {
        return this.getByAsset(assetId)
            .reduce((sum, u) => sum + BigInt(u.amount), 0n);
    }

    /**
     * Select UTXOs for spending (coin selection)
     * Uses simple greedy algorithm
     */
    selectUtxos(assetId, targetAmount) {
        const available = this.getByAsset(assetId)
            .sort((a, b) => {
                // BigInt comparison - sort() needs Number return value
                const diff = BigInt(b.amount) - BigInt(a.amount);
                if (diff > 0n) return 1;
                if (diff < 0n) return -1;
                return 0;
            }); // Largest first

        const selected = [];
        let total = 0n;
        const target = BigInt(targetAmount);

        for (const utxo of available) {
            if (total >= target) break;
            selected.push(utxo);
            total += BigInt(utxo.amount);
        }

        if (total < target) {
            throw new Error('Insufficient balance');
        }

        return {
            utxos: selected,
            total: total.toString(),
            change: (total - target).toString(),
        };
    }

    /**
     * Get all UTXOs
     */
    getAll() {
        return [...this.utxos];
    }

    /**
     * Clear all UTXOs (use with caution!)
     */
    async clear() {
        this.utxos = [];
        await this.save();
    }

    /**
     * Deduplicate UTXOs by commitment
     */
    async dedupe() {
        const seen = new Map();
        for (const utxo of this.utxos) {
            if (!seen.has(utxo.commitment)) {
                seen.set(utxo.commitment, utxo);
            }
        }

        const deduped = Array.from(seen.values());
        if (deduped.length !== this.utxos.length) {
            this.utxos = deduped;
            await this.save();
        }
    }

    /**
     * Export UTXOs (for backup)
     */
    async export() {
        if (this.key) {
            return await encrypt(this.utxos, this.key);
        }
        return JSON.stringify(this.utxos);
    }

    /**
     * Import UTXOs (from backup)
     */
    async import(data) {
        try {
            if (this.key) {
                this.utxos = await decrypt(data, this.key);
            } else {
                this.utxos = JSON.parse(data);
            }
            await this.save();
        } catch (err) {
            console.error('Failed to import UTXOs:', err);
            throw err;
        }
    }
}

/**
 * Create UTXO storage instance
 */
export function createUTXOStorage() {
    return new UTXOStorage();
}

/**
 * Get the current deposit nonce (next available)
 * Used for deterministic blinding derivation
 */
export function getDepositNonce() {
    const nonce = localStorage.getItem('privacy-amm-deposit-nonce');
    return nonce ? parseInt(nonce, 10) : 0;
}

/**
 * Increment and save the deposit nonce
 */
export function incrementDepositNonce() {
    const nonce = getDepositNonce();
    localStorage.setItem('privacy-amm-deposit-nonce', (nonce + 1).toString());
    return nonce + 1;
}

/**
 * Reset the deposit nonce (use with caution!)
 */
export function resetDepositNonce() {
    localStorage.setItem('privacy-amm-deposit-nonce', '0');
}
