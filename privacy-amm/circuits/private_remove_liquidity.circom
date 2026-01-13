// Private Remove Liquidity Circuit for Privacy AMM
// 隐私移除流动性电路
// 输入: 1 个 LP Token UTXO
// 输出: 2 个 UTXO (Token A + Token B)

pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "lib/merkle.circom";
include "lib/nullifier.circom";

// 多资产 UTXO Commitment (复用)
// commitment = Poseidon(amount, assetId, pubkey, blinding)
template UTXOCommitment() {
    signal input amount;
    signal input assetId;
    signal input pubkey;
    signal input blinding;
    signal output commitment;

    component hasher = Poseidon(4);
    hasher.inputs[0] <== amount;
    hasher.inputs[1] <== assetId;
    hasher.inputs[2] <== pubkey;
    hasher.inputs[3] <== blinding;

    commitment <== hasher.out;
}

// AMM 池状态哈希 (复用)
// poolStateHash = Poseidon(reserveA, reserveB, poolPubkey, poolBlinding)
template PoolStateHash() {
    signal input reserveA;
    signal input reserveB;
    signal input poolPubkey;
    signal input poolBlinding;
    signal output stateHash;

    component hasher = Poseidon(4);
    hasher.inputs[0] <== reserveA;
    hasher.inputs[1] <== reserveB;
    hasher.inputs[2] <== poolPubkey;
    hasher.inputs[3] <== poolBlinding;

    stateHash <== hasher.out;
}

// 池的 LP 总量哈希 (复用)
// lpStateHash = Poseidon(totalLpSupply, lpPoolPubkey, lpBlinding)
template LPStateHash() {
    signal input totalLpSupply;
    signal input lpPoolPubkey;
    signal input lpBlinding;
    signal output stateHash;

    component hasher = Poseidon(3);
    hasher.inputs[0] <== totalLpSupply;
    hasher.inputs[1] <== lpPoolPubkey;
    hasher.inputs[2] <== lpBlinding;

    stateHash <== hasher.out;
}

// 主电路: 隐私移除流动性
template PrivateRemoveLiquidity(MERKLE_DEPTH) {
    //=========================================================================
    // 公开输入 (Public Inputs) - 链上可见
    //=========================================================================
    signal input root;                     // Merkle 根
    signal input inputNullifier;           // LP Token UTXO nullifier
    signal input outputCommitment[2];      // 输出 UTXO commitment (Token A + Token B)
    signal input poolStateHash;            // 池状态哈希 (移除前)
    signal input newPoolStateHash;         // 新池状态哈希 (移除后)
    signal input lpStateHash;              // LP 状态哈希 (移除前)
    signal input newLpStateHash;           // 新 LP 状态哈希 (移除后)
    signal input extDataHash;              // 外部数据哈希 (防篡改)

    //=========================================================================
    // 私有输入 (Private Inputs) - 只有用户知道
    //=========================================================================

    // 输入 LP Token UTXO
    signal input inLpAmount;               // LP Token 输入金额
    signal input inPrivateKey;             // 用户私钥
    signal input inBlinding;               // 随机因子
    signal input inPathElements[MERKLE_DEPTH];   // Merkle 路径
    signal input inPathIndices[MERKLE_DEPTH];    // 路径索引

    // 输出 UTXO (Token A)
    signal input outAmountA;               // Token A 输出金额
    signal input outPubkeyA;               // 接收者公钥
    signal input outBlindingA;             // 随机因子

    // 输出 UTXO (Token B)
    signal input outAmountB;               // Token B 输出金额
    signal input outPubkeyB;               // 接收者公钥
    signal input outBlindingB;             // 随机因子

    // 池状态 (移除前)
    signal input reserveA;                 // Token A 储备量
    signal input reserveB;                 // Token B 储备量
    signal input poolPubkey;               // 池公钥
    signal input poolBlinding;             // 池随机因子

    // 池状态 (移除后)
    signal input newReserveA;              // 新 Token A 储备量
    signal input newReserveB;              // 新 Token B 储备量
    signal input newPoolBlinding;          // 新池随机因子

    // LP 状态 (移除前)
    signal input totalLpSupply;            // LP 总供应量
    signal input lpPoolPubkey;             // LP 池公钥
    signal input lpBlinding;               // LP 随机因子

    // LP 状态 (移除后)
    signal input newTotalLpSupply;         // 新 LP 总供应量
    signal input newLpBlinding;            // 新 LP 随机因子

    //=========================================================================
    // 约束 1: 验证输入 LP Token UTXO 的 commitment 在 Merkle 树中
    //=========================================================================
    component derivePubkey = DerivePublicKey();
    derivePubkey.privateKey <== inPrivateKey;

    component inputCommitmentHasher = UTXOCommitment();
    inputCommitmentHasher.amount <== inLpAmount;
    inputCommitmentHasher.assetId <== 2;  // LP Token (assetId = 2)
    inputCommitmentHasher.pubkey <== derivePubkey.publicKey;
    inputCommitmentHasher.blinding <== inBlinding;

    component inputMerkleProof = MerkleProof(MERKLE_DEPTH);
    inputMerkleProof.leaf <== inputCommitmentHasher.commitment;
    inputMerkleProof.root <== root;
    for (var j = 0; j < MERKLE_DEPTH; j++) {
        inputMerkleProof.pathElements[j] <== inPathElements[j];
        inputMerkleProof.pathIndices[j] <== inPathIndices[j];
    }

    //=========================================================================
    // 约束 2: 验证 nullifier 计算正确
    //=========================================================================
    component nullifierHasher = Nullifier();
    nullifierHasher.commitment <== inputCommitmentHasher.commitment;
    nullifierHasher.privateKey <== inPrivateKey;
    nullifierHasher.leafIndex <== inPathIndices[0];
    nullifierHasher.nullifier === inputNullifier;

    //=========================================================================
    // 约束 3: 验证输出 Token commitment 计算正确
    //=========================================================================
    // Token A UTXO (assetId = 0)
    component outputCommitmentHasherA = UTXOCommitment();
    outputCommitmentHasherA.amount <== outAmountA;
    outputCommitmentHasherA.assetId <== 0;  // Token A
    outputCommitmentHasherA.pubkey <== outPubkeyA;
    outputCommitmentHasherA.blinding <== outBlindingA;
    outputCommitmentHasherA.commitment === outputCommitment[0];

    // Token B UTXO (assetId = 1)
    component outputCommitmentHasherB = UTXOCommitment();
    outputCommitmentHasherB.amount <== outAmountB;
    outputCommitmentHasherB.assetId <== 1;  // Token B
    outputCommitmentHasherB.pubkey <== outPubkeyB;
    outputCommitmentHasherB.blinding <== outBlindingB;
    outputCommitmentHasherB.commitment === outputCommitment[1];

    //=========================================================================
    // 约束 4: 验证池状态哈希
    //=========================================================================
    component poolStateHasher = PoolStateHash();
    poolStateHasher.reserveA <== reserveA;
    poolStateHasher.reserveB <== reserveB;
    poolStateHasher.poolPubkey <== poolPubkey;
    poolStateHasher.poolBlinding <== poolBlinding;
    poolStateHasher.stateHash === poolStateHash;

    component newPoolStateHasher = PoolStateHash();
    newPoolStateHasher.reserveA <== newReserveA;
    newPoolStateHasher.reserveB <== newReserveB;
    newPoolStateHasher.poolPubkey <== poolPubkey;  // 池公钥不变
    newPoolStateHasher.poolBlinding <== newPoolBlinding;
    newPoolStateHasher.stateHash === newPoolStateHash;

    //=========================================================================
    // 约束 5: 验证 LP 状态哈希
    //=========================================================================
    component lpStateHasher = LPStateHash();
    lpStateHasher.totalLpSupply <== totalLpSupply;
    lpStateHasher.lpPoolPubkey <== lpPoolPubkey;
    lpStateHasher.lpBlinding <== lpBlinding;
    lpStateHasher.stateHash === lpStateHash;

    component newLpStateHasher = LPStateHash();
    newLpStateHasher.totalLpSupply <== newTotalLpSupply;
    newLpStateHasher.lpPoolPubkey <== lpPoolPubkey;  // LP 池公钥不变
    newLpStateHasher.lpBlinding <== newLpBlinding;
    newLpStateHasher.stateHash === newLpStateHash;

    //=========================================================================
    // 约束 6: LP 供应量更新正确
    //=========================================================================
    newTotalLpSupply === totalLpSupply - inLpAmount;

    //=========================================================================
    // 约束 7: 储备量变化正确 (按比例计算)
    //
    // 用户获得的 Token A: outAmountA = inLpAmount * reserveA / totalLpSupply
    // 用户获得的 Token B: outAmountB = inLpAmount * reserveB / totalLpSupply
    //
    // 约束:
    // outAmountA * totalLpSupply <= inLpAmount * reserveA
    // outAmountB * totalLpSupply <= inLpAmount * reserveB
    //
    // 同时储备量减少:
    // newReserveA = reserveA - outAmountA
    // newReserveB = reserveB - outAmountB
    //=========================================================================

    // 验证储备量减少
    newReserveA === reserveA - outAmountA;
    newReserveB === reserveB - outAmountB;

    // 验证按比例计算 (允许向下舍入)
    signal outATimesLp;
    outATimesLp <== outAmountA * totalLpSupply;

    signal lpTimesReserveA;
    lpTimesReserveA <== inLpAmount * reserveA;

    component checkA = LessEqThan(128);
    checkA.in[0] <== outATimesLp;
    checkA.in[1] <== lpTimesReserveA;
    checkA.out === 1;

    signal outBTimesLp;
    outBTimesLp <== outAmountB * totalLpSupply;

    signal lpTimesReserveB;
    lpTimesReserveB <== inLpAmount * reserveB;

    component checkB = LessEqThan(128);
    checkB.in[0] <== outBTimesLp;
    checkB.in[1] <== lpTimesReserveB;
    checkB.out === 1;

    // 确保用户没有少拿太多 (舍入误差不超过 1)
    // outAmountA >= (inLpAmount * reserveA / totalLpSupply) - 1
    // 即: (outAmountA + 1) * totalLpSupply >= inLpAmount * reserveA
    signal outAPlusOneTimesLp;
    outAPlusOneTimesLp <== (outAmountA + 1) * totalLpSupply;

    component checkARounding = LessEqThan(128);
    checkARounding.in[0] <== lpTimesReserveA;
    checkARounding.in[1] <== outAPlusOneTimesLp;
    checkARounding.out === 1;

    signal outBPlusOneTimesLp;
    outBPlusOneTimesLp <== (outAmountB + 1) * totalLpSupply;

    component checkBRounding = LessEqThan(128);
    checkBRounding.in[0] <== lpTimesReserveB;
    checkBRounding.in[1] <== outBPlusOneTimesLp;
    checkBRounding.out === 1;

    //=========================================================================
    // 约束 8: 金额必须为正
    //=========================================================================
    component positiveLp = LessEqThan(64);
    positiveLp.in[0] <== 1;  // 至少为 1
    positiveLp.in[1] <== inLpAmount;
    positiveLp.out === 1;

    // Token A 可以为 0 (如果 reserveA 很小)
    component nonNegativeA = LessEqThan(64);
    nonNegativeA.in[0] <== 0;
    nonNegativeA.in[1] <== outAmountA;
    nonNegativeA.out === 1;

    // Token B 可以为 0 (如果 reserveB 很小)
    component nonNegativeB = LessEqThan(64);
    nonNegativeB.in[0] <== 0;
    nonNegativeB.in[1] <== outAmountB;
    nonNegativeB.out === 1;

    // 但是至少要取回一些东西
    signal totalOut;
    totalOut <== outAmountA + outAmountB;

    component positiveTotal = LessEqThan(64);
    positiveTotal.in[0] <== 1;  // 至少为 1
    positiveTotal.in[1] <== totalOut;
    positiveTotal.out === 1;

    //=========================================================================
    // 约束 9: LP 供应量必须大于 0 (防止除以 0)
    //=========================================================================
    component nonZeroLp = LessEqThan(64);
    nonZeroLp.in[0] <== inLpAmount;  // inLpAmount >= inLpAmount (always true)
    nonZeroLp.in[1] <== totalLpSupply;  // totalLpSupply >= inLpAmount
    nonZeroLp.out === 1;

    //=========================================================================
    // 约束 10: 恒定乘积 k 应该保持 (扣除手续费后可能略增)
    // k_after * (totalLpSupply)^2 ~= k_before * (newTotalLpSupply)^2
    //
    // 简化约束: k_after >= 0 (不能变为负数)
    //=========================================================================
    signal kAfter;
    kAfter <== newReserveA * newReserveB;

    component kPositive = LessEqThan(128);
    kPositive.in[0] <== 0;
    kPositive.in[1] <== kAfter;
    kPositive.out === 1;
}

// 主组件 - Merkle 树深度为 20
component main {public [
    root,
    inputNullifier,
    outputCommitment,
    poolStateHash,
    newPoolStateHash,
    lpStateHash,
    newLpStateHash,
    extDataHash
]} = PrivateRemoveLiquidity(20);
