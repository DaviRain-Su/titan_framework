/**
 * Merkle Tree for Browser
 * Syncs with on-chain Merkle state and generates proofs
 */

import { poseidonHash, initPoseidon } from './zkProver.js';

const MERKLE_DEPTH = 20;
const TREE_SIZE = 2 ** MERKLE_DEPTH;

// Pre-computed zero values for each level
let ZERO_VALUES = null;

/**
 * Initialize zero values for the Merkle tree
 */
async function initZeroValues() {
    if (ZERO_VALUES) return ZERO_VALUES;

    await initPoseidon();

    ZERO_VALUES = new Array(MERKLE_DEPTH + 1);
    ZERO_VALUES[0] = '0';

    for (let i = 1; i <= MERKLE_DEPTH; i++) {
        ZERO_VALUES[i] = await poseidonHash([ZERO_VALUES[i - 1], ZERO_VALUES[i - 1]]);
    }

    return ZERO_VALUES;
}

/**
 * Merkle Tree class
 */
export class MerkleTree {
    constructor() {
        this.leaves = [];
        this.layers = [];
        this.nextIndex = 0;
    }

    /**
     * Initialize the tree
     */
    async init() {
        await initZeroValues();
        this.layers = new Array(MERKLE_DEPTH + 1);
        for (let i = 0; i <= MERKLE_DEPTH; i++) {
            this.layers[i] = new Map();
        }
    }

    /**
     * Insert a leaf into the tree
     */
    async insert(commitment) {
        if (this.nextIndex >= TREE_SIZE) {
            throw new Error('Merkle tree is full');
        }

        const index = this.nextIndex;
        this.leaves.push(commitment);

        // Update the tree
        let currentIndex = index;
        let currentValue = commitment;

        for (let level = 0; level < MERKLE_DEPTH; level++) {
            this.layers[level].set(currentIndex, currentValue);

            const siblingIndex = currentIndex ^ 1;
            const siblingValue = this.layers[level].get(siblingIndex) || ZERO_VALUES[level];

            const isLeft = currentIndex % 2 === 0;
            if (isLeft) {
                currentValue = await poseidonHash([currentValue, siblingValue]);
            } else {
                currentValue = await poseidonHash([siblingValue, currentValue]);
            }

            currentIndex = Math.floor(currentIndex / 2);
        }

        // Update root
        this.layers[MERKLE_DEPTH].set(0, currentValue);

        this.nextIndex++;
        return index;
    }

    /**
     * Get the current root
     */
    getRoot() {
        if (this.nextIndex === 0) {
            return ZERO_VALUES[MERKLE_DEPTH];
        }
        return this.layers[MERKLE_DEPTH].get(0);
    }

    /**
     * Get Merkle proof for a leaf
     */
    getProof(leafIndex) {
        if (leafIndex >= this.nextIndex) {
            throw new Error('Leaf index out of bounds');
        }

        const pathElements = [];
        const pathIndices = [];

        let currentIndex = leafIndex;

        for (let level = 0; level < MERKLE_DEPTH; level++) {
            const siblingIndex = currentIndex ^ 1;
            const siblingValue = this.layers[level].get(siblingIndex) || ZERO_VALUES[level];

            pathElements.push(siblingValue);
            pathIndices.push(currentIndex % 2);

            currentIndex = Math.floor(currentIndex / 2);
        }

        return { pathElements, pathIndices };
    }

    /**
     * Verify a Merkle proof
     */
    async verifyProof(leaf, pathElements, pathIndices) {
        let currentValue = leaf;

        for (let i = 0; i < MERKLE_DEPTH; i++) {
            const isLeft = pathIndices[i] === 0;
            if (isLeft) {
                currentValue = await poseidonHash([currentValue, pathElements[i]]);
            } else {
                currentValue = await poseidonHash([pathElements[i], currentValue]);
            }
        }

        return currentValue === this.getRoot();
    }

    /**
     * Get the number of leaves
     */
    getLeafCount() {
        return this.nextIndex;
    }

    /**
     * Serialize tree state for storage
     */
    serialize() {
        return JSON.stringify({
            leaves: this.leaves,
            nextIndex: this.nextIndex,
        });
    }

    /**
     * Deserialize tree state from storage
     */
    async deserialize(data) {
        const { leaves, nextIndex } = JSON.parse(data);
        await this.init();

        // Rebuild tree from leaves
        for (const leaf of leaves) {
            await this.insert(leaf);
        }

        return this;
    }
}

/**
 * Create a new Merkle tree
 */
export async function createMerkleTree() {
    const tree = new MerkleTree();
    await tree.init();
    return tree;
}

/**
 * Sync Merkle tree from on-chain state
 */
export async function syncMerkleTreeFromChain(rpcUrl, merkleAccountPubkey) {
    try {
        // Fetch account data from Solana
        const response = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'getAccountInfo',
                params: [
                    merkleAccountPubkey,
                    { encoding: 'base64' },
                ],
            }),
        });

        const result = await response.json();

        if (!result.result || !result.result.value) {
            console.warn('Merkle account not found, using empty tree');
            return createMerkleTree();
        }

        // Decode account data
        const data = Buffer.from(result.result.value.data[0], 'base64');

        // Parse on-chain Merkle state
        // Format: [root: [u8; 32], next_index: u32, leaves: [commitment; max_leaves]]
        // Root is at offset 0-32, next_index at offset 32-36, leaves start at offset 36
        const ROOT_SIZE = 32;
        const NEXT_INDEX_OFFSET = ROOT_SIZE;
        const LEAVES_OFFSET = ROOT_SIZE + 4;
        const COMMITMENT_SIZE = 32;

        const nextIndex = data.readUInt32LE(NEXT_INDEX_OFFSET);
        console.log(`On-chain Merkle tree has ${nextIndex} leaves`);

        const tree = await createMerkleTree();

        // Read and insert leaves
        for (let i = 0; i < nextIndex; i++) {
            const offset = LEAVES_OFFSET + i * COMMITMENT_SIZE;
            const commitmentBytes = data.slice(offset, offset + COMMITMENT_SIZE);

            // Convert bytes to field element string (little-endian)
            let commitment = BigInt(0);
            for (let j = 31; j >= 0; j--) {
                commitment = commitment * 256n + BigInt(commitmentBytes[j]);
            }

            await tree.insert(commitment.toString());
        }

        console.log(`Synced ${nextIndex} leaves from on-chain Merkle tree`);
        return tree;

    } catch (err) {
        console.error('Failed to sync Merkle tree:', err);
        return createMerkleTree();
    }
}

/**
 * Watch for new Merkle tree updates via WebSocket
 */
export function watchMerkleTreeUpdates(wsUrl, merkleAccountPubkey, onUpdate) {
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        // Subscribe to account changes
        ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'accountSubscribe',
            params: [
                merkleAccountPubkey,
                { encoding: 'base64', commitment: 'confirmed' },
            ],
        }));
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.method === 'accountNotification') {
            // Account updated, trigger resync
            onUpdate();
        }
    };

    ws.onerror = (err) => {
        console.error('WebSocket error:', err);
    };

    return () => ws.close();
}
