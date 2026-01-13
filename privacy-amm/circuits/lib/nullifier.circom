// Nullifier Computation
// 用于防止双花的作废标记

pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";

// 计算 UTXO 的 Nullifier
// nullifier = Poseidon(commitment, privateKey, leafIndex)
template Nullifier() {
    signal input commitment;
    signal input privateKey;
    signal input leafIndex;
    signal output nullifier;

    component hasher = Poseidon(3);
    hasher.inputs[0] <== commitment;
    hasher.inputs[1] <== privateKey;
    hasher.inputs[2] <== leafIndex;

    nullifier <== hasher.out;
}

// 从私钥派生公钥
// pubkey = Poseidon(privateKey)
template DerivePublicKey() {
    signal input privateKey;
    signal output publicKey;

    component hasher = Poseidon(1);
    hasher.inputs[0] <== privateKey;
    publicKey <== hasher.out;
}

// 检查 Nullifier 计算是否正确
// 用于在电路中验证 nullifier 的有效性
template VerifyNullifier() {
    signal input commitment;
    signal input privateKey;
    signal input leafIndex;
    signal input nullifier;

    component calc = Nullifier();
    calc.commitment <== commitment;
    calc.privateKey <== privateKey;
    calc.leafIndex <== leafIndex;

    // 验证 nullifier 正确
    calc.nullifier === nullifier;
}
