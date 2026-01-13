// Private Add Liquidity Circuit for Privacy AMM
// 隐私添加流动性电路
// 输入: 2 个 UTXO (Token A + Token B)
// 输出: 1 个 LP Token UTXO

pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/mux1.circom";
include "lib/merkle.circom";
include "lib/nullifier.circom";

// 多资产 UTXO Commitment (复用自 private_swap.circom)
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

// AMM 池状态哈希 (复用自 private_swap.circom)
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

// 池的 LP 总量哈希
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

// 主电路: 隐私添加流动性
template PrivateAddLiquidity(MERKLE_DEPTH) {
    //=========================================================================
    // 公开输入 (Public Inputs) - 链上可见
    //=========================================================================
    signal input root;                     // Merkle 根
    signal input inputNullifier[2];        // 输入 UTXO nullifier (Token A + Token B)
    signal input outputCommitment;         // 输出 LP Token UTXO commitment
    signal input poolStateHash;            // 池状态哈希 (添加前)
    signal input newPoolStateHash;         // 新池状态哈希 (添加后)
    signal input lpStateHash;              // LP 状态哈希 (添加前)
    signal input newLpStateHash;           // 新 LP 状态哈希 (添加后)
    signal input extDataHash;              // 外部数据哈希 (防篡改)

    //=========================================================================
    // 私有输入 (Private Inputs) - 只有用户知道
    //=========================================================================

    // 输入 UTXO (用户提供流动性的 Token A 和 Token B)
    signal input inAmountA;                // Token A 输入金额
    signal input inAmountB;                // Token B 输入金额
    signal input inPrivateKey[2];          // 用户私钥
    signal input inBlinding[2];            // 随机因子
    signal input inPathElements[2][MERKLE_DEPTH];  // Merkle 路径
    signal input inPathIndices[2][MERKLE_DEPTH];   // 路径索引

    // 输出 LP Token UTXO
    signal input outLpAmount;              // LP Token 输出金额
    signal input outPubkey;                // 接收者公钥
    signal input outBlinding;              // 随机因子

    // 池状态 (添加前)
    signal input reserveA;                 // Token A 储备量
    signal input reserveB;                 // Token B 储备量
    signal input poolPubkey;               // 池公钥
    signal input poolBlinding;             // 池随机因子

    // 池状态 (添加后)
    signal input newReserveA;              // 新 Token A 储备量
    signal input newReserveB;              // 新 Token B 储备量
    signal input newPoolBlinding;          // 新池随机因子

    // LP 状态 (添加前)
    signal input totalLpSupply;            // LP 总供应量
    signal input lpPoolPubkey;             // LP 池公钥
    signal input lpBlinding;               // LP 随机因子

    // LP 状态 (添加后)
    signal input newTotalLpSupply;         // 新 LP 总供应量
    signal input newLpBlinding;            // 新 LP 随机因子

    //=========================================================================
    // 约束 1: 验证输入 UTXO 的 commitment 在 Merkle 树中
    //=========================================================================
    component inputCommitmentHasher[2];
    component inputMerkleProof[2];
    component derivePubkey[2];

    // Token A UTXO (assetId = 0)
    derivePubkey[0] = DerivePublicKey();
    derivePubkey[0].privateKey <== inPrivateKey[0];

    inputCommitmentHasher[0] = UTXOCommitment();
    inputCommitmentHasher[0].amount <== inAmountA;
    inputCommitmentHasher[0].assetId <== 0;  // Token A
    inputCommitmentHasher[0].pubkey <== derivePubkey[0].publicKey;
    inputCommitmentHasher[0].blinding <== inBlinding[0];

    inputMerkleProof[0] = MerkleProof(MERKLE_DEPTH);
    inputMerkleProof[0].leaf <== inputCommitmentHasher[0].commitment;
    inputMerkleProof[0].root <== root;
    for (var j = 0; j < MERKLE_DEPTH; j++) {
        inputMerkleProof[0].pathElements[j] <== inPathElements[0][j];
        inputMerkleProof[0].pathIndices[j] <== inPathIndices[0][j];
    }

    // Token B UTXO (assetId = 1)
    derivePubkey[1] = DerivePublicKey();
    derivePubkey[1].privateKey <== inPrivateKey[1];

    inputCommitmentHasher[1] = UTXOCommitment();
    inputCommitmentHasher[1].amount <== inAmountB;
    inputCommitmentHasher[1].assetId <== 1;  // Token B
    inputCommitmentHasher[1].pubkey <== derivePubkey[1].publicKey;
    inputCommitmentHasher[1].blinding <== inBlinding[1];

    inputMerkleProof[1] = MerkleProof(MERKLE_DEPTH);
    inputMerkleProof[1].leaf <== inputCommitmentHasher[1].commitment;
    inputMerkleProof[1].root <== root;
    for (var j = 0; j < MERKLE_DEPTH; j++) {
        inputMerkleProof[1].pathElements[j] <== inPathElements[1][j];
        inputMerkleProof[1].pathIndices[j] <== inPathIndices[1][j];
    }

    //=========================================================================
    // 约束 2: 验证 nullifier 计算正确
    //=========================================================================
    component nullifierHasher[2];

    for (var i = 0; i < 2; i++) {
        nullifierHasher[i] = Nullifier();
        nullifierHasher[i].commitment <== inputCommitmentHasher[i].commitment;
        nullifierHasher[i].privateKey <== inPrivateKey[i];
        nullifierHasher[i].leafIndex <== inPathIndices[i][0];
        nullifierHasher[i].nullifier === inputNullifier[i];
    }

    //=========================================================================
    // 约束 3: 验证输出 LP Token commitment 计算正确
    //=========================================================================
    component outputCommitmentHasher = UTXOCommitment();
    outputCommitmentHasher.amount <== outLpAmount;
    outputCommitmentHasher.assetId <== 2;  // LP Token (assetId = 2)
    outputCommitmentHasher.pubkey <== outPubkey;
    outputCommitmentHasher.blinding <== outBlinding;
    outputCommitmentHasher.commitment === outputCommitment;

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
    // 约束 6: 储备量变化正确
    //=========================================================================
    // 新储备 = 旧储备 + 用户输入
    newReserveA === reserveA + inAmountA;
    newReserveB === reserveB + inAmountB;

    //=========================================================================
    // 约束 7: LP Token 计算正确
    //
    // 首次添加流动性: LP = sqrt(amountA * amountB)
    // 后续添加: LP = min(amountA/reserveA, amountB/reserveB) * totalLpSupply
    //
    // 为简化电路，我们使用比例公式:
    // LP_minted = amountA * totalLpSupply / reserveA
    // 约束: amountA * totalLpSupply <= LP_minted * reserveA
    // 约束: amountB * totalLpSupply <= LP_minted * reserveB
    //
    // 对于首次添加 (totalLpSupply = 0):
    // LP = sqrt(amountA * amountB)
    // 约束: LP^2 <= amountA * amountB
    //=========================================================================

    // 判断是否为首次添加
    signal isFirstDeposit;
    component isZeroLp = IsZero();
    isZeroLp.in <== totalLpSupply;
    isFirstDeposit <== isZeroLp.out;

    // 首次添加: LP^2 <= amountA * amountB
    signal lpSquared;
    lpSquared <== outLpAmount * outLpAmount;

    signal productAB;
    productAB <== inAmountA * inAmountB;

    // 非首次添加: 按比例计算
    // LP_minted * reserveA <= amountA * newTotalLpSupply
    signal lpTimesReserveA;
    lpTimesReserveA <== outLpAmount * reserveA;

    signal amountATimesLp;
    amountATimesLp <== inAmountA * totalLpSupply;

    // LP 供应量更新
    newTotalLpSupply === totalLpSupply + outLpAmount;

    // LP Token 计算验证 (根据是否首次添加)
    // 首次: lpSquared <= productAB
    // 后续: lpTimesReserveA <= amountATimesLp + outLpAmount (允许舍入)
    component lpCheckFirst = LessEqThan(128);
    lpCheckFirst.in[0] <== lpSquared;
    lpCheckFirst.in[1] <== productAB;

    component lpCheckSubsequent = LessEqThan(128);
    lpCheckSubsequent.in[0] <== lpTimesReserveA;
    lpCheckSubsequent.in[1] <== amountATimesLp + outLpAmount;

    // 使用 Mux 根据 isFirstDeposit 选择检查
    component muxLpCheck = Mux1();
    muxLpCheck.c[0] <== lpCheckSubsequent.out;  // 非首次
    muxLpCheck.c[1] <== lpCheckFirst.out;       // 首次
    muxLpCheck.s <== isFirstDeposit;
    muxLpCheck.out === 1;

    //=========================================================================
    // 约束 8: 金额必须为正
    //=========================================================================
    component positiveA = LessEqThan(64);
    positiveA.in[0] <== 1;  // 至少为 1
    positiveA.in[1] <== inAmountA;
    positiveA.out === 1;

    component positiveB = LessEqThan(64);
    positiveB.in[0] <== 1;  // 至少为 1
    positiveB.in[1] <== inAmountB;
    positiveB.out === 1;

    component positiveLp = LessEqThan(64);
    positiveLp.in[0] <== 1;  // 至少为 1
    positiveLp.in[1] <== outLpAmount;
    positiveLp.out === 1;

    //=========================================================================
    // 约束 9: AMM 恒定乘积公式 k_after >= k_before
    //=========================================================================
    signal kBefore;
    signal kAfter;

    kBefore <== reserveA * reserveB;
    kAfter <== newReserveA * newReserveB;

    component kCheck = LessEqThan(128);
    kCheck.in[0] <== kBefore;
    kCheck.in[1] <== kAfter;
    kCheck.out === 1;
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
]} = PrivateAddLiquidity(20);
