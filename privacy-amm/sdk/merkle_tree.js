/**
 * Merkle Tree for Privacy AMM
 * Uses Poseidon hash for ZK-friendly operations
 */

const { buildPoseidon } = require('circomlibjs');

class MerkleTree {
    constructor(depth, poseidon) {
        this.depth = depth;
        this.poseidon = poseidon;
        this.F = poseidon.F;

        // Initialize with zeros
        this.zeros = this.generateZeros();
        this.leaves = [];
        this.layers = [];

        // Initialize empty tree
        this.rebuild();
    }

    /**
     * Generate zero values for each level
     */
    generateZeros() {
        const zeros = [BigInt(0)];
        for (let i = 1; i <= this.depth; i++) {
            zeros.push(this.hashPair(zeros[i - 1], zeros[i - 1]));
        }
        return zeros;
    }

    /**
     * Hash two values using Poseidon
     */
    hashPair(left, right) {
        const hash = this.poseidon([left, right]);
        return this.F.toObject(hash);
    }

    /**
     * Insert a new leaf
     * @returns {number} Index of the inserted leaf
     */
    insert(leaf) {
        const leafBigInt = BigInt(leaf);
        const index = this.leaves.length;
        this.leaves.push(leafBigInt);
        this.rebuild();
        return index;
    }

    /**
     * Rebuild tree from leaves
     */
    rebuild() {
        this.layers = [];

        // First layer is leaves padded with zeros
        const numLeaves = Math.pow(2, this.depth);
        const paddedLeaves = [...this.leaves];
        while (paddedLeaves.length < numLeaves) {
            paddedLeaves.push(this.zeros[0]);
        }
        this.layers.push(paddedLeaves);

        // Build remaining layers
        for (let level = 1; level <= this.depth; level++) {
            const prevLayer = this.layers[level - 1];
            const currentLayer = [];

            for (let i = 0; i < prevLayer.length; i += 2) {
                const left = prevLayer[i];
                const right = prevLayer[i + 1];
                currentLayer.push(this.hashPair(left, right));
            }

            this.layers.push(currentLayer);
        }
    }

    /**
     * Get the root of the tree
     */
    getRoot() {
        if (this.layers.length === 0) {
            return this.zeros[this.depth];
        }
        return this.layers[this.depth][0];
    }

    /**
     * Get Merkle proof for a leaf at given index
     */
    getProof(index) {
        if (index < 0 || index >= this.leaves.length) {
            throw new Error('Invalid leaf index');
        }

        const pathElements = [];
        const pathIndices = [];

        let currentIndex = index;
        for (let level = 0; level < this.depth; level++) {
            const isRight = currentIndex % 2 === 1;
            const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;

            const layer = this.layers[level];
            const sibling = siblingIndex < layer.length ? layer[siblingIndex] : this.zeros[level];

            pathElements.push(sibling.toString());
            pathIndices.push(isRight ? 1 : 0);

            currentIndex = Math.floor(currentIndex / 2);
        }

        return {
            pathElements,
            pathIndices,
            root: this.getRoot().toString(),
        };
    }

    /**
     * Verify a Merkle proof
     */
    verifyProof(leaf, pathElements, pathIndices) {
        let current = BigInt(leaf);

        for (let i = 0; i < this.depth; i++) {
            const sibling = BigInt(pathElements[i]);
            const isRight = pathIndices[i] === 1;

            if (isRight) {
                current = this.hashPair(sibling, current);
            } else {
                current = this.hashPair(current, sibling);
            }
        }

        return current === this.getRoot();
    }
}

/**
 * Create a new Merkle tree
 * @param {number} depth - Tree depth (e.g., 20 for ~1M leaves)
 */
async function createMerkleTree(depth = 20) {
    const poseidon = await buildPoseidon();
    return new MerkleTree(depth, poseidon);
}

module.exports = {
    MerkleTree,
    createMerkleTree,
};
