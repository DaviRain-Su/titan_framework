// Private Swap Circuit for Privacy AMM
// 隐私 AMM 交换电路 - 核心 ZK 电路

pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/mux1.circom";
include "lib/merkle.circom";
include "lib/nullifier.circom";

// 多资产 UTXO Commitment
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

// AMM 池状态哈希
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

// 主电路: 隐私交换
template PrivateSwap(MERKLE_DEPTH) {
    //=========================================================================
    // 公开输入 (Public Inputs) - 链上可见
    //=========================================================================
    signal input root;                     // Merkle 根
    signal input inputNullifier[2];        // 输入 UTXO nullifier
    signal input outputCommitment[2];      // 输出 UTXO commitment
    signal input poolStateHash;            // 池状态哈希 (交换前)
    signal input newPoolStateHash;         // 新池状态哈希 (交换后)
    signal input extDataHash;              // 外部数据哈希 (防篡改)

    //=========================================================================
    // 私有输入 (Private Inputs) - 只有用户知道
    //=========================================================================

    // 输入 UTXO (用户要花费的)
    signal input inAmount[2];              // 输入金额
    signal input inAssetId[2];             // 资产类型 (0=TokenA, 1=TokenB)
    signal input inPrivateKey[2];          // 用户私钥
    signal input inBlinding[2];            // 随机因子
    signal input inPathElements[2][MERKLE_DEPTH];  // Merkle 路径
    signal input inPathIndices[2][MERKLE_DEPTH];   // 路径索引

    // 输出 UTXO (用户将收到的)
    signal input outAmount[2];             // 输出金额
    signal input outAssetId[2];            // 资产类型
    signal input outPubkey[2];             // 接收者公钥
    signal input outBlinding[2];           // 随机因子

    // 池状态 (交换前)
    signal input reserveA;                 // Token A 储备量
    signal input reserveB;                 // Token B 储备量
    signal input poolPubkey;               // 池公钥
    signal input poolBlinding;             // 池随机因子

    // 池状态 (交换后)
    signal input newReserveA;              // 新 Token A 储备量
    signal input newReserveB;              // 新 Token B 储备量
    signal input newPoolBlinding;          // 新池随机因子

    // Swap 参数
    signal input swapAmountIn;             // Swap 输入量
    signal input swapAssetIn;              // Swap 输入资产类型 (0 或 1)
    signal input swapAmountOut;            // Swap 输出量
    signal input minAmountOut;             // 最小输出量 (滑点保护)

    //=========================================================================
    // 约束 1: 验证输入 UTXO 的 commitment 在 Merkle 树中
    //=========================================================================
    component inputCommitmentHasher[2];
    component inputMerkleProof[2];
    component derivePubkey[2];

    for (var i = 0; i < 2; i++) {
        // 从私钥派生公钥
        derivePubkey[i] = DerivePublicKey();
        derivePubkey[i].privateKey <== inPrivateKey[i];

        // 计算输入 UTXO 的 commitment
        inputCommitmentHasher[i] = UTXOCommitment();
        inputCommitmentHasher[i].amount <== inAmount[i];
        inputCommitmentHasher[i].assetId <== inAssetId[i];
        inputCommitmentHasher[i].pubkey <== derivePubkey[i].publicKey;
        inputCommitmentHasher[i].blinding <== inBlinding[i];

        // 验证 Merkle 证明
        inputMerkleProof[i] = MerkleProof(MERKLE_DEPTH);
        inputMerkleProof[i].leaf <== inputCommitmentHasher[i].commitment;
        inputMerkleProof[i].root <== root;
        for (var j = 0; j < MERKLE_DEPTH; j++) {
            inputMerkleProof[i].pathElements[j] <== inPathElements[i][j];
            inputMerkleProof[i].pathIndices[j] <== inPathIndices[i][j];
        }
    }

    //=========================================================================
    // 约束 2: 验证 nullifier 计算正确
    //=========================================================================
    component nullifierHasher[2];

    for (var i = 0; i < 2; i++) {
        nullifierHasher[i] = Nullifier();
        nullifierHasher[i].commitment <== inputCommitmentHasher[i].commitment;
        nullifierHasher[i].privateKey <== inPrivateKey[i];
        // 使用第一个路径索引作为 leafIndex
        nullifierHasher[i].leafIndex <== inPathIndices[i][0];

        // 验证 nullifier 正确
        nullifierHasher[i].nullifier === inputNullifier[i];
    }

    //=========================================================================
    // 约束 3: 验证输出 commitment 计算正确
    //=========================================================================
    component outputCommitmentHasher[2];

    for (var i = 0; i < 2; i++) {
        outputCommitmentHasher[i] = UTXOCommitment();
        outputCommitmentHasher[i].amount <== outAmount[i];
        outputCommitmentHasher[i].assetId <== outAssetId[i];
        outputCommitmentHasher[i].pubkey <== outPubkey[i];
        outputCommitmentHasher[i].blinding <== outBlinding[i];

        outputCommitmentHasher[i].commitment === outputCommitment[i];
    }

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
    // 约束 5: AMM 恒定乘积公式 k_after >= k_before
    //=========================================================================
    signal kBefore;
    signal kAfter;

    kBefore <== reserveA * reserveB;
    kAfter <== newReserveA * newReserveB;

    // k 只能增加或保持不变 (手续费导致增加)
    component kCheck = LessEqThan(128);
    kCheck.in[0] <== kBefore;
    kCheck.in[1] <== kAfter;
    kCheck.out === 1;

    //=========================================================================
    // 约束 6: 储备量变化与 swap 数量一致
    //=========================================================================
    // swapAssetIn 必须是 0 或 1
    swapAssetIn * (1 - swapAssetIn) === 0;

    signal deltaA;
    signal deltaB;

    deltaA <== newReserveA - reserveA;
    deltaB <== newReserveB - reserveB;

    // 如果 swapAssetIn = 0 (TokenA 作为输入):
    //   deltaA = +swapAmountIn, deltaB = -swapAmountOut
    // 如果 swapAssetIn = 1 (TokenB 作为输入):
    //   deltaA = -swapAmountOut, deltaB = +swapAmountIn

    // 使用 mux 实现条件逻辑
    component muxDeltaA = Mux1();
    muxDeltaA.c[0] <== swapAmountIn;           // swapAssetIn = 0
    muxDeltaA.c[1] <== 0 - swapAmountOut;      // swapAssetIn = 1
    muxDeltaA.s <== swapAssetIn;

    component muxDeltaB = Mux1();
    muxDeltaB.c[0] <== 0 - swapAmountOut;      // swapAssetIn = 0
    muxDeltaB.c[1] <== swapAmountIn;           // swapAssetIn = 1
    muxDeltaB.s <== swapAssetIn;

    deltaA === muxDeltaA.out;
    deltaB === muxDeltaB.out;

    //=========================================================================
    // 约束 7: 资金守恒
    //=========================================================================
    // 用户输入金额总和 - swapIn + swapOut = 用户输出金额总和
    signal totalInAmount;
    signal totalOutAmount;

    totalInAmount <== inAmount[0] + inAmount[1];
    totalOutAmount <== outAmount[0] + outAmount[1];

    signal netUserBalance;
    netUserBalance <== totalInAmount - swapAmountIn + swapAmountOut;
    netUserBalance === totalOutAmount;

    //=========================================================================
    // 约束 8: 滑点保护
    //=========================================================================
    component slippageCheck = LessEqThan(128);
    slippageCheck.in[0] <== minAmountOut;
    slippageCheck.in[1] <== swapAmountOut;
    slippageCheck.out === 1;

    //=========================================================================
    // 约束 9: 金额必须为正 (防止溢出攻击)
    //=========================================================================
    component positiveIn[2];
    component positiveOut[2];

    for (var i = 0; i < 2; i++) {
        positiveIn[i] = LessEqThan(64);
        positiveIn[i].in[0] <== 0;
        positiveIn[i].in[1] <== inAmount[i];
        positiveIn[i].out === 1;

        positiveOut[i] = LessEqThan(64);
        positiveOut[i].in[0] <== 0;
        positiveOut[i].in[1] <== outAmount[i];
        positiveOut[i].out === 1;
    }

    component positiveSwapIn = LessEqThan(64);
    positiveSwapIn.in[0] <== 0;
    positiveSwapIn.in[1] <== swapAmountIn;
    positiveSwapIn.out === 1;

    component positiveSwapOut = LessEqThan(64);
    positiveSwapOut.in[0] <== 0;
    positiveSwapOut.in[1] <== swapAmountOut;
    positiveSwapOut.out === 1;
}

// 主组件 - Merkle 树深度为 20 (支持约 100 万 UTXO)
component main {public [
    root,
    inputNullifier,
    outputCommitment,
    poolStateHash,
    newPoolStateHash,
    extDataHash
]} = PrivateSwap(20);
