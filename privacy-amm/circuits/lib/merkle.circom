// Merkle Tree Proof Verification
// 验证一个叶子节点是否在 Merkle 树中

pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/mux1.circom";

// 单层 Merkle 哈希
// 根据 pathIndex 决定 left/right 位置
template MerkleHash() {
    signal input left;
    signal input right;
    signal output out;

    component hasher = Poseidon(2);
    hasher.inputs[0] <== left;
    hasher.inputs[1] <== right;
    out <== hasher.out;
}

// Merkle 树路径验证器
// 验证 leaf 在以 root 为根的树中
template MerkleProof(DEPTH) {
    signal input leaf;
    signal input root;
    signal input pathElements[DEPTH];  // 路径上的兄弟节点
    signal input pathIndices[DEPTH];   // 0 = leaf在左, 1 = leaf在右

    signal intermediateHashes[DEPTH + 1];
    intermediateHashes[0] <== leaf;

    component hashers[DEPTH];
    component mux[DEPTH];

    for (var i = 0; i < DEPTH; i++) {
        // 确保 pathIndices 是 0 或 1
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        // 根据 pathIndex 选择 left/right
        mux[i] = MultiMux1(2);
        mux[i].c[0][0] <== intermediateHashes[i];
        mux[i].c[0][1] <== pathElements[i];
        mux[i].c[1][0] <== pathElements[i];
        mux[i].c[1][1] <== intermediateHashes[i];
        mux[i].s <== pathIndices[i];

        // 计算当前层的哈希
        hashers[i] = MerkleHash();
        hashers[i].left <== mux[i].out[0];
        hashers[i].right <== mux[i].out[1];

        intermediateHashes[i + 1] <== hashers[i].out;
    }

    // 最终哈希必须等于根
    root === intermediateHashes[DEPTH];
}

// 计算空 Merkle 树的初始根 (所有叶子为 0)
// 用于初始化时计算初始根
template EmptyMerkleRoot(DEPTH) {
    signal output root;

    // 预计算的空树哈希值
    // 这些值需要在部署前用 Poseidon 计算
    var ZERO_VALUES[21];
    ZERO_VALUES[0] = 0;

    // 实际实现中，这些值应该预先计算好
    // ZERO_VALUES[i] = Poseidon(ZERO_VALUES[i-1], ZERO_VALUES[i-1])

    root <== ZERO_VALUES[DEPTH];
}
