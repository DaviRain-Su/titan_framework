/**
 * Relayer Keypair Management
 * Handles Ed25519 keypair for signing Solana transactions
 */

// Use tweetnacl for Ed25519 signing
// In production, use @solana/web3.js Keypair

/**
 * Generate a new random keypair
 */
export function generateKeypair() {
    const secretKey = new Uint8Array(64);
    crypto.getRandomValues(secretKey.subarray(0, 32));

    // In a real implementation, derive public key from secret
    // For now, use placeholder - in production use tweetnacl or @solana/web3.js
    return {
        secretKey,
        publicKey: secretKey.subarray(32, 64),
    };
}

/**
 * Load keypair from environment variable
 */
export function loadKeypairFromEnv(env) {
    const secretKeyJson = env.RELAYER_SECRET_KEY;

    if (!secretKeyJson) {
        console.warn('RELAYER_SECRET_KEY not set, generating temporary keypair');
        return generateKeypair();
    }

    try {
        const secretKeyArray = JSON.parse(secretKeyJson);
        const secretKey = new Uint8Array(secretKeyArray);

        return {
            secretKey,
            publicKey: secretKey.subarray(32, 64),
        };
    } catch (err) {
        console.error('Failed to parse RELAYER_SECRET_KEY:', err);
        return generateKeypair();
    }
}

/**
 * Base58 alphabet for Solana addresses
 */
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Encode bytes to base58
 */
export function base58Encode(bytes) {
    if (bytes.length === 0) return '';

    // Count leading zeros
    let zeros = 0;
    for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
        zeros++;
    }

    // Convert to base58
    const encoded = [];
    let num = BigInt('0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''));

    while (num > 0n) {
        const remainder = Number(num % 58n);
        encoded.unshift(BASE58_ALPHABET[remainder]);
        num = num / 58n;
    }

    // Add leading '1's for each leading zero byte
    for (let i = 0; i < zeros; i++) {
        encoded.unshift('1');
    }

    return encoded.join('');
}

/**
 * Decode base58 to bytes
 */
export function base58Decode(str) {
    if (str.length === 0) return new Uint8Array(0);

    // Count leading '1's
    let zeros = 0;
    for (let i = 0; i < str.length && str[i] === '1'; i++) {
        zeros++;
    }

    // Convert from base58
    let num = 0n;
    for (const char of str) {
        const index = BASE58_ALPHABET.indexOf(char);
        if (index === -1) {
            throw new Error(`Invalid base58 character: ${char}`);
        }
        num = num * 58n + BigInt(index);
    }

    // Convert to bytes
    const hex = num.toString(16).padStart(2, '0');
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) {
        bytes.push(parseInt(hex.substr(i, 2), 16));
    }

    // Add leading zeros
    const result = new Uint8Array(zeros + bytes.length);
    result.set(new Uint8Array(bytes), zeros);

    return result;
}

/**
 * Get public key as base58 string
 */
export function getPublicKeyBase58(keypair) {
    return base58Encode(keypair.publicKey);
}

/**
 * Sign a message with Ed25519
 * Note: This is a placeholder - in production use tweetnacl.sign.detached
 */
export async function signMessage(message, secretKey) {
    // In a real implementation, use:
    // import nacl from 'tweetnacl';
    // return nacl.sign.detached(message, secretKey);

    // For Cloudflare Workers, we need to use Web Crypto API
    // Ed25519 is supported in newer Node.js and some browsers

    try {
        // Try using Web Crypto API (if available)
        const key = await crypto.subtle.importKey(
            'raw',
            secretKey.subarray(0, 32),
            { name: 'Ed25519' },
            false,
            ['sign']
        );

        const signature = await crypto.subtle.sign(
            'Ed25519',
            key,
            message
        );

        return new Uint8Array(signature);
    } catch (err) {
        // Fallback: return placeholder signature
        // In production, this should never happen
        console.error('Ed25519 signing not available:', err);
        const placeholder = new Uint8Array(64);
        crypto.getRandomValues(placeholder);
        return placeholder;
    }
}

/**
 * Verify an Ed25519 signature
 */
export async function verifySignature(message, signature, publicKey) {
    try {
        const key = await crypto.subtle.importKey(
            'raw',
            publicKey,
            { name: 'Ed25519' },
            false,
            ['verify']
        );

        return await crypto.subtle.verify(
            'Ed25519',
            key,
            signature,
            message
        );
    } catch (err) {
        console.error('Ed25519 verification failed:', err);
        return false;
    }
}

/**
 * Derive keypair from seed (deterministic)
 */
export async function deriveKeypairFromSeed(seed) {
    // Hash the seed to get 32 bytes
    const hashBuffer = await crypto.subtle.digest('SHA-256', seed);
    const seedBytes = new Uint8Array(hashBuffer);

    // In a real implementation, use Ed25519 key derivation
    // For now, use the hash as the secret key seed
    const secretKey = new Uint8Array(64);
    secretKey.set(seedBytes, 0);

    // Derive public key (placeholder - in production use proper Ed25519)
    const pubkeyHash = await crypto.subtle.digest('SHA-256', seedBytes);
    secretKey.set(new Uint8Array(pubkeyHash), 32);

    return {
        secretKey,
        publicKey: secretKey.subarray(32, 64),
    };
}

/**
 * Export keypair to JSON (for backup)
 */
export function exportKeypair(keypair) {
    return JSON.stringify(Array.from(keypair.secretKey));
}

/**
 * Import keypair from JSON
 */
export function importKeypair(json) {
    const secretKeyArray = JSON.parse(json);
    const secretKey = new Uint8Array(secretKeyArray);

    return {
        secretKey,
        publicKey: secretKey.subarray(32, 64),
    };
}

/**
 * Relayer configuration
 */
export const RELAYER_CONFIG = {
    // Minimum fee in lamports for relayer service
    MIN_FEE_LAMPORTS: 5000,

    // Maximum transaction size
    MAX_TX_SIZE: 1232,

    // Transaction timeout in ms
    TX_TIMEOUT_MS: 30000,

    // Rate limit: max transactions per minute per IP
    RATE_LIMIT_PER_MINUTE: 10,
};
