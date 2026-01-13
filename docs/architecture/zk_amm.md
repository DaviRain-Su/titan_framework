### 18.49 Privacy-Cash SDK 集成 - 隐私 AMM 产品设计

> **核心目标**: 基于 Privacy-Cash SDK 现有能力，使用 Titan 框架快速构建隐私 AMM 产品

#### 18.49.1 Privacy-Cash SDK 能力分析

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Privacy-Cash SDK 架构分析                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  核心能力:                                                                  │
│  ══════════                                                                 │
│                                                                             │
│  1. UTXO 隐私模型                                                          │
│     • commitment = poseidon(amount, pubKey, blinding)                      │
│     • nullifier = poseidon(commitment, privateKey, pathIndex)              │
│     • 隐藏金额 + 打破交易链接                                              │
│                                                                             │
│  2. Merkle 树存储                                                          │
│     • 增量 Merkle 树 (深度 20)                                             │
│     • 支持 2^20 = 约 100 万个 UTXO                                         │
│     • 高效的 inclusion proof                                               │
│                                                                             │
│  3. ZK-SNARK 证明系统                                                      │
│     • Groth16 on BN254                                                     │
│     • 预编译电路 (transaction2.wasm + transaction2.zkey)                  │
│     • snarkjs 生成/验证证明                                                │
│                                                                             │
│  4. Relayer 架构                                                           │
│     • 用户不直接提交交易                                                   │
│     • Relayer 代提交，保护发送者身份                                       │
│     • 费用从隐私金额中扣除                                                 │
│                                                                             │
│  已有组件:                                                                  │
│  ══════════                                                                 │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                                                                     │   │
│  │  privacy-cash-sdk/                                                  │   │
│  │  ├── circuits/                                                      │   │
│  │  │   └── transaction2.circom      # 核心交易电路                   │   │
│  │  ├── build/                                                         │   │
│  │  │   ├── transaction2.wasm        # 编译后的 Wasm                  │   │
│  │  │   ├── transaction2.zkey        # Groth16 proving key            │   │
│  │  │   └── verification_key.json    # 验证密钥                       │   │
│  │  ├── src/                                                           │   │
│  │  │   ├── privacy-cash.ts          # 主入口                         │   │
│  │  │   ├── utxo.ts                  # UTXO 管理                      │   │
│  │  │   ├── merkle.ts                # Merkle 树                      │   │
│  │  │   ├── poseidon.ts              # Poseidon 哈希                  │   │
│  │  │   └── prover.ts                # 证明生成                       │   │
│  │  └── solana-program/              # Solana 验证合约                │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 18.49.2 transaction2.circom 电路分析

```circom
// Privacy-Cash 核心电路结构 (简化)
template Transaction(MERKLE_DEPTH) {
    // 公开输入 (Public Inputs)
    signal input root;                    // Merkle 根
    signal input nullifier[2];            // 输入 UTXO 的 nullifier
    signal input outputCommitment[2];     // 输出 UTXO 的 commitment
    signal input extDataHash;             // 外部数据哈希 (防篡改)

    // 私有输入 (Private Inputs)
    signal input inAmount[2];             // 输入金额
    signal input inPrivateKey[2];         // 私钥
    signal input inBlinding[2];           // 随机因子
    signal input inPathElements[2][MERKLE_DEPTH];  // Merkle 路径
    signal input inPathIndices[2][MERKLE_DEPTH];   // 路径索引

    signal input outAmount[2];            // 输出金额
    signal input outPubkey[2];            // 接收者公钥
    signal input outBlinding[2];          // 输出随机因子

    // 约束:
    // 1. 输入金额总和 = 输出金额总和
    // 2. 每个输入 UTXO 的 commitment 在 Merkle 树中
    // 3. nullifier 计算正确
    // 4. 输出 commitment 计算正确
}
```

#### 18.49.3 隐私 AMM 扩展设计

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    隐私 AMM = Privacy-Cash + AMM 逻辑                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  设计思路:                                                                  │
│  ══════════                                                                 │
│                                                                             │
│  基于 Privacy-Cash 的 UTXO 模型，扩展支持:                                │
│                                                                             │
│  1. 多资产 UTXO                                                            │
│     commitment = poseidon(amount, asset_id, pubkey, blinding)              │
│                                                                             │
│  2. 流动性池状态                                                           │
│     pool_state = poseidon(reserve_a, reserve_b, total_lp, pool_pubkey)    │
│                                                                             │
│  3. AMM 价格约束                                                           │
│     新增电路约束: out_amount = (in_amount * reserve_out) / reserve_in     │
│                                                                             │
│  两种实现方案:                                                              │
│  ══════════════                                                             │
│                                                                             │
│  ┌─────────────────────────────────┬─────────────────────────────────────┐ │
│  │     Plan A: 扩展现有电路         │     Plan B: 纯 Titan/Zig 实现      │ │
│  ├─────────────────────────────────┼─────────────────────────────────────┤ │
│  │                                 │                                     │ │
│  │ • 复用 privacy-cash 基础设施   │ • 使用 titan-zk-sdk 全新设计       │ │
│  │ • 新增 private_swap.circom     │ • zig-to-noir 转译                  │ │
│  │ • TypeScript SDK 包装          │ • 纯 Zig 开发体验                   │ │
│  │                                 │                                     │ │
│  │ 优势:                           │ 优势:                               │ │
│  │ ✅ 快速 MVP (2-3 周)           │ ✅ 完全符合 Titan 哲学             │ │
│  │ ✅ 复用成熟组件                 │ ✅ 统一开发体验                     │ │
│  │ ✅ 降低技术风险                 │ ✅ 长期可维护性                     │ │
│  │                                 │                                     │ │
│  │ 劣势:                           │ 劣势:                               │ │
│  │ ❌ 混合技术栈                   │ ❌ 开发周期长 (4-6 周)             │ │
│  │ ❌ 需要 Circom 知识             │ ❌ 需要 zig-to-noir 先完成         │ │
│  │                                 │                                     │ │
│  └─────────────────────────────────┴─────────────────────────────────────┘ │
│                                                                             │
│  推荐策略: Plan A (MVP) → Plan B (长期)                                    │
│                                                                             │
│  先用 Plan A 快速验证市场，获得用户反馈                                    │
│  同时并行开发 zig-to-noir，完成后迁移到 Plan B                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 18.49.4 private_swap.circom 电路设计

```circom
// 文件: circuits/private_swap.circom
// 隐私 AMM Swap 电路 - 扩展 Privacy-Cash 的 transaction2

pragma circom 2.0.0;

include "./node_modules/circomlib/circuits/poseidon.circom";
include "./node_modules/circomlib/circuits/comparators.circom";
include "./merkle_tree.circom";
include "./nullifier.circom";

template PrivateSwap(MERKLE_DEPTH) {
    //=========================================================================
    // 公开输入 (Public Inputs) - 链上可见
    //=========================================================================
    signal input root;                     // Merkle 根
    signal input inputNullifier[2];        // 输入 UTXO nullifier
    signal input outputCommitment[2];      // 输出 UTXO commitment
    signal input poolStateHash;            // 池状态哈希 (before)
    signal input newPoolStateHash;         // 新池状态哈希 (after)
    signal input extDataHash;              // 外部数据哈希

    //=========================================================================
    // 私有输入 (Private Inputs) - 只有用户知道
    //=========================================================================

    // 输入 UTXO (用户要卖的资产)
    signal input inAmount[2];              // 输入金额
    signal input inAsset[2];               // 资产类型 (0=TokenA, 1=TokenB)
    signal input inPrivateKey[2];          // 私钥
    signal input inBlinding[2];            // 随机因子
    signal input inPathElements[2][MERKLE_DEPTH];
    signal input inPathIndices[2][MERKLE_DEPTH];

    // 输出 UTXO (用户要买的资产)
    signal input outAmount[2];             // 输出金额
    signal input outAsset[2];              // 资产类型
    signal input outPubkey[2];             // 接收者公钥
    signal input outBlinding[2];           // 随机因子

    // 池状态
    signal input reserveA;                 // Token A 储备量
    signal input reserveB;                 // Token B 储备量
    signal input newReserveA;              // 新 Token A 储备量
    signal input newReserveB;              // 新 Token B 储备量
    signal input poolPubkey;               // 池公钥
    signal input poolBlinding;             // 池随机因子
    signal input newPoolBlinding;          // 新池随机因子

    // Swap 参数
    signal input swapAmountIn;             // Swap 输入量
    signal input swapAssetIn;              // Swap 输入资产类型
    signal input swapAmountOut;            // Swap 输出量 (计算得到)
    signal input minAmountOut;             // 最小输出量 (滑点保护)

    //=========================================================================
    // 约束 1: 验证输入 UTXO 在 Merkle 树中
    //=========================================================================
    component inputCommitmentHasher[2];
    component inputMerkleProof[2];

    for (var i = 0; i < 2; i++) {
        // 计算输入 UTXO 的 commitment
        inputCommitmentHasher[i] = Poseidon(4);
        inputCommitmentHasher[i].inputs[0] <== inAmount[i];
        inputCommitmentHasher[i].inputs[1] <== inAsset[i];
        inputCommitmentHasher[i].inputs[2] <== inPrivateKey[i]; // 实际应该是派生的 pubkey
        inputCommitmentHasher[i].inputs[3] <== inBlinding[i];

        // 验证 Merkle 证明
        inputMerkleProof[i] = MerkleProof(MERKLE_DEPTH);
        inputMerkleProof[i].leaf <== inputCommitmentHasher[i].out;
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
        nullifierHasher[i] = Poseidon(3);
        nullifierHasher[i].inputs[0] <== inputCommitmentHasher[i].out;
        nullifierHasher[i].inputs[1] <== inPrivateKey[i];
        nullifierHasher[i].inputs[2] <== inPathIndices[i][0]; // 用路径索引作为唯一性

        nullifierHasher[i].out === inputNullifier[i];
    }

    //=========================================================================
    // 约束 3: 验证输出 commitment 计算正确
    //=========================================================================
    component outputCommitmentHasher[2];

    for (var i = 0; i < 2; i++) {
        outputCommitmentHasher[i] = Poseidon(4);
        outputCommitmentHasher[i].inputs[0] <== outAmount[i];
        outputCommitmentHasher[i].inputs[1] <== outAsset[i];
        outputCommitmentHasher[i].inputs[2] <== outPubkey[i];
        outputCommitmentHasher[i].inputs[3] <== outBlinding[i];

        outputCommitmentHasher[i].out === outputCommitment[i];
    }

    //=========================================================================
    // 约束 4: 验证池状态哈希
    //=========================================================================
    component poolStateHasher = Poseidon(4);
    poolStateHasher.inputs[0] <== reserveA;
    poolStateHasher.inputs[1] <== reserveB;
    poolStateHasher.inputs[2] <== poolPubkey;
    poolStateHasher.inputs[3] <== poolBlinding;
    poolStateHasher.out === poolStateHash;

    component newPoolStateHasher = Poseidon(4);
    newPoolStateHasher.inputs[0] <== newReserveA;
    newPoolStateHasher.inputs[1] <== newReserveB;
    newPoolStateHasher.inputs[2] <== poolPubkey;
    newPoolStateHasher.inputs[3] <== newPoolBlinding;
    newPoolStateHasher.out === newPoolStateHash;

    //=========================================================================
    // 约束 5: AMM 恒定乘积公式
    //=========================================================================
    // 验证: reserveA * reserveB = newReserveA * newReserveB (考虑手续费后)
    // 简化: 使用 x * y = k 公式

    signal kBefore;
    signal kAfter;

    kBefore <== reserveA * reserveB;
    kAfter <== newReserveA * newReserveB;

    // k 只能增加或保持不变 (手续费导致)
    component kCheck = LessEqThan(128);
    kCheck.in[0] <== kBefore;
    kCheck.in[1] <== kAfter;
    kCheck.out === 1;

    //=========================================================================
    // 约束 6: 储备量变化与 swap 数量一致
    //=========================================================================
    // 如果 swapAssetIn = 0 (TokenA): newReserveA = reserveA + swapAmountIn
    //                                newReserveB = reserveB - swapAmountOut
    // 如果 swapAssetIn = 1 (TokenB): newReserveB = reserveB + swapAmountIn
    //                                newReserveA = reserveA - swapAmountOut

    component isTokenA = IsZero();
    isTokenA.in <== swapAssetIn;

    // 使用 selector 进行条件约束
    signal deltaA;
    signal deltaB;

    deltaA <== newReserveA - reserveA;
    deltaB <== newReserveB - reserveB;

    // Token A 作为输入时: deltaA = +swapAmountIn, deltaB = -swapAmountOut
    // Token B 作为输入时: deltaA = -swapAmountOut, deltaB = +swapAmountIn
    signal expectedDeltaA;
    signal expectedDeltaB;

    expectedDeltaA <== isTokenA.out * swapAmountIn + (1 - isTokenA.out) * (0 - swapAmountOut);
    expectedDeltaB <== isTokenA.out * (0 - swapAmountOut) + (1 - isTokenA.out) * swapAmountIn;

    deltaA === expectedDeltaA;
    deltaB === expectedDeltaB;

    //=========================================================================
    // 约束 7: 资金守恒 (输入 = 输出 + swap)
    //=========================================================================
    signal totalInAmount;
    signal totalOutAmount;

    totalInAmount <== inAmount[0] + inAmount[1];
    totalOutAmount <== outAmount[0] + outAmount[1];

    // 用户输入的 UTXO 金额 = 用户收到的 UTXO 金额 + 给池子的金额 - 从池子收到的金额
    // 简化: 假设单资产 swap
    // totalInAmount = totalOutAmount + swapAmountIn - swapAmountOut
    // 即: totalInAmount - swapAmountIn + swapAmountOut = totalOutAmount

    signal netUserChange;
    netUserChange <== totalInAmount - swapAmountIn + swapAmountOut;
    netUserChange === totalOutAmount;

    //=========================================================================
    // 约束 8: 滑点保护
    //=========================================================================
    component slippageCheck = LessEqThan(128);
    slippageCheck.in[0] <== minAmountOut;
    slippageCheck.in[1] <== swapAmountOut;
    slippageCheck.out === 1;
}

component main {public [
    root,
    inputNullifier,
    outputCommitment,
    poolStateHash,
    newPoolStateHash,
    extDataHash
]} = PrivateSwap(20);
```

#### 18.49.5 Titan CLI Zig 封装层

```zig
// 文件: titan-privacy-amm/src/cli/swap.zig
// Titan CLI 的隐私 swap 命令封装

const std = @import("std");
const json = std.json;
const process = std.process;

/// Privacy Swap 配置
pub const SwapConfig = struct {
    /// 输入资产 (mint address)
    token_in: []const u8,
    /// 输出资产 (mint address)
    token_out: []const u8,
    /// 输入金额 (以最小单位计)
    amount_in: u64,
    /// 最小输出金额 (滑点保护)
    min_amount_out: u64,
    /// 用户私钥 (hex)
    private_key: []const u8,
    /// 接收者公钥 (默认为自己)
    recipient: ?[]const u8 = null,
    /// RPC 端点
    rpc_url: []const u8 = "https://api.mainnet-beta.solana.com",
    /// Relayer URL
    relayer_url: []const u8 = "https://relayer.titan-privacy.io",
};

/// Swap 结果
pub const SwapResult = struct {
    /// 交易签名
    tx_signature: []const u8,
    /// 实际输出金额
    actual_amount_out: u64,
    /// 新 UTXO commitment
    output_commitment: []const u8,
    /// 证明生成时间 (ms)
    proof_time_ms: u64,
};

/// 执行隐私 swap
pub fn executePrivateSwap(allocator: std.mem.Allocator, config: SwapConfig) !SwapResult {
    // 1. 获取用户的 UTXO
    const utxos = try fetchUserUtxos(allocator, config);
    defer allocator.free(utxos);

    // 2. 选择合适的输入 UTXO
    const selected = try selectUtxosForAmount(allocator, utxos, config.token_in, config.amount_in);
    defer allocator.free(selected.utxos);

    // 3. 获取池状态
    const pool_state = try fetchPoolState(allocator, config);
    defer allocator.free(pool_state.data);

    // 4. 计算 swap 输出量 (基于 AMM 公式)
    const amount_out = calculateSwapOutput(
        config.amount_in,
        pool_state.reserve_in,
        pool_state.reserve_out,
    );

    // 验证滑点
    if (amount_out < config.min_amount_out) {
        return error.SlippageExceeded;
    }

    // 5. 生成找零 UTXO (如果有多余)
    const change = if (selected.total > config.amount_in)
        selected.total - config.amount_in
    else
        0;

    // 6. 构建电路输入
    const circuit_input = try buildCircuitInput(allocator, .{
        .input_utxos = selected.utxos,
        .swap_amount_in = config.amount_in,
        .swap_amount_out = amount_out,
        .change_amount = change,
        .pool_state = pool_state,
        .private_key = config.private_key,
        .recipient = config.recipient,
    });
    defer allocator.free(circuit_input);

    // 7. 调用 snarkjs 生成证明
    const start_time = std.time.milliTimestamp();
    const proof = try generateProof(allocator, circuit_input);
    defer allocator.free(proof.data);
    const proof_time = std.time.milliTimestamp() - start_time;

    // 8. 发送到 Relayer
    const tx_sig = try submitToRelayer(allocator, config.relayer_url, proof);
    defer allocator.free(tx_sig);

    return SwapResult{
        .tx_signature = try allocator.dupe(u8, tx_sig),
        .actual_amount_out = amount_out,
        .output_commitment = try allocator.dupe(u8, proof.output_commitment),
        .proof_time_ms = @intCast(proof_time),
    };
}

/// 生成 ZK 证明 (调用 snarkjs)
fn generateProof(allocator: std.mem.Allocator, input: []const u8) !ProofData {
    // 写入临时输入文件
    const input_path = "/tmp/titan_swap_input.json";
    const proof_path = "/tmp/titan_swap_proof.json";
    const public_path = "/tmp/titan_swap_public.json";

    {
        const file = try std.fs.createFileAbsolute(input_path, .{});
        defer file.close();
        try file.writeAll(input);
    }

    // 调用 snarkjs
    const result = try process.Child.run(.{
        .allocator = allocator,
        .argv = &[_][]const u8{
            "snarkjs",
            "groth16",
            "prove",
            "circuits/build/private_swap.zkey",
            input_path,
            proof_path,
            public_path,
        },
    });
    defer allocator.free(result.stdout);
    defer allocator.free(result.stderr);

    if (result.term.Exited != 0) {
        std.log.err("snarkjs failed: {s}", .{result.stderr});
        return error.ProofGenerationFailed;
    }

    // 读取证明
    const proof_file = try std.fs.openFileAbsolute(proof_path, .{});
    defer proof_file.close();
    const proof_data = try proof_file.readToEndAlloc(allocator, 1024 * 1024);

    // 解析并返回
    return ProofData{
        .data = proof_data,
        .output_commitment = try extractCommitment(allocator, public_path),
    };
}

/// AMM 恒定乘积公式
fn calculateSwapOutput(amount_in: u64, reserve_in: u128, reserve_out: u128) u64 {
    // amount_out = (amount_in * 997 * reserve_out) / (reserve_in * 1000 + amount_in * 997)
    // 0.3% 手续费
    const amount_in_with_fee = @as(u128, amount_in) * 997;
    const numerator = amount_in_with_fee * reserve_out;
    const denominator = reserve_in * 1000 + amount_in_with_fee;
    return @intCast(numerator / denominator);
}

/// UTXO 数据结构
const Utxo = struct {
    commitment: [32]u8,
    amount: u64,
    asset: []const u8,
    blinding: [32]u8,
    path_elements: [][32]u8,
    path_indices: []u1,
};

const PoolState = struct {
    data: []const u8,
    reserve_in: u128,
    reserve_out: u128,
    state_hash: [32]u8,
};

const ProofData = struct {
    data: []const u8,
    output_commitment: []const u8,
};

// ... 其他辅助函数
```

#### 18.49.6 完整工作流程图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    隐私 AMM Swap 完整流程                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  用户视角:                                                                  │
│  ══════════                                                                 │
│                                                                             │
│  $ titan swap --token-in SOL --token-out USDC --amount 1.5 --min-out 150   │
│                                                                             │
│  内部执行:                                                                  │
│  ══════════                                                                 │
│                                                                             │
│  ┌─────────┐    ┌──────────────┐    ┌──────────────┐    ┌─────────────┐   │
│  │         │    │              │    │              │    │             │   │
│  │  用户   │───▶│  Titan CLI   │───▶│  Proof Gen   │───▶│  Relayer    │   │
│  │         │    │   (Zig)      │    │  (snarkjs)   │    │             │   │
│  │         │    │              │    │              │    │             │   │
│  └─────────┘    └──────────────┘    └──────────────┘    └──────┬──────┘   │
│       │                │                    │                   │          │
│       │                │                    │                   ▼          │
│       │                │                    │          ┌─────────────┐    │
│       │                │                    │          │             │    │
│       │                │                    │          │   Solana    │    │
│       │                │                    │          │  (Verifier) │    │
│       │                │                    │          │             │    │
│       │                │                    │          └─────────────┘    │
│       │                │                    │                   │          │
│       ▼                ▼                    ▼                   ▼          │
│                                                                             │
│  步骤详解:                                                                  │
│  ══════════                                                                 │
│                                                                             │
│  1. 用户输入                                                                │
│     ├── 解析命令行参数                                                     │
│     ├── 加载用户私钥 (从环境变量或 keyfile)                               │
│     └── 验证参数有效性                                                     │
│                                                                             │
│  2. Titan CLI (Zig)                                                         │
│     ├── 查询用户的隐私 UTXO 集合                                          │
│     ├── 选择满足金额的 UTXO                                                │
│     ├── 获取当前 Merkle root                                               │
│     ├── 获取 AMM 池状态                                                    │
│     ├── 计算 swap 输出量                                                   │
│     ├── 检查滑点保护                                                       │
│     ├── 生成找零 UTXO                                                      │
│     └── 构建电路输入 JSON                                                  │
│                                                                             │
│  3. Proof Generation (snarkjs)                                              │
│     ├── 加载 private_swap.wasm                                             │
│     ├── 加载 private_swap.zkey                                             │
│     ├── 执行 Witness 计算                                                  │
│     ├── 生成 Groth16 证明                                                  │
│     └── 输出 proof.json + public.json                                      │
│                                                                             │
│  4. Relayer                                                                 │
│     ├── 接收 proof + public inputs                                         │
│     ├── 构建 Solana 交易                                                   │
│     ├── 签名并提交                                                         │
│     └── 返回交易签名                                                       │
│                                                                             │
│  5. Solana (链上)                                                           │
│     ├── Verifier Program 验证证明                                          │
│     ├── 检查 nullifier 未使用                                              │
│     ├── 更新 Merkle 树                                                     │
│     ├── 更新 AMM 池状态                                                    │
│     ├── 记录新 commitment                                                  │
│     └── 标记 nullifier 已用                                                │
│                                                                             │
│  隐私保证:                                                                  │
│  ══════════                                                                 │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                                                                     │   │
│  │  • 链上只看到: nullifier, commitment, pool_state_hash              │   │
│  │  • 无法知道: 谁在交易, 金额多少, 买卖方向                         │   │
│  │  • Relayer 无法作恶: 只负责提交, 无法篡改                         │   │
│  │  • 前端可验证: 用户可本地验证证明                                  │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 18.49.7 项目结构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    titan-privacy-amm 项目结构                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  titan-privacy-amm/                                                         │
│  ├── circuits/                        # ZK 电路                            │
│  │   ├── private_swap.circom          # 主电路                             │
│  │   ├── merkle_tree.circom           # Merkle 验证 (复用 privacy-cash)   │
│  │   ├── nullifier.circom             # Nullifier 计算                     │
│  │   └── build/                       # 编译输出                           │
│  │       ├── private_swap.wasm        # Wasm witness 计算器               │
│  │       ├── private_swap.zkey        # Proving key                        │
│  │       └── verification_key.json    # 验证密钥                           │
│  │                                                                         │
│  ├── solana-program/                  # Solana 链上程序                    │
│  │   ├── src/                                                              │
│  │   │   ├── lib.zig                  # 主入口 (用 solana-zig-sdk)        │
│  │   │   ├── verifier.zig             # Groth16 验证器                     │
│  │   │   ├── merkle.zig               # 链上 Merkle 树                     │
│  │   │   ├── pool.zig                 # AMM 池状态管理                     │
│  │   │   └── nullifier_set.zig        # Nullifier 集合                     │
│  │   └── build.zig                                                         │
│  │                                                                         │
│  ├── cli/                             # Titan CLI 命令                     │
│  │   ├── src/                                                              │
│  │   │   ├── main.zig                 # CLI 入口                           │
│  │   │   ├── swap.zig                 # swap 命令                          │
│  │   │   ├── deposit.zig              # deposit 命令 (公开→隐私)          │
│  │   │   ├── withdraw.zig             # withdraw 命令 (隐私→公开)         │
│  │   │   └── balance.zig              # 查询隐私余额                       │
│  │   └── build.zig                                                         │
│  │                                                                         │
│  ├── sdk/                             # TypeScript SDK (可选)             │
│  │   ├── src/                                                              │
│  │   │   ├── index.ts                                                      │
│  │   │   ├── prover.ts                                                     │
│  │   │   └── utxo.ts                                                       │
│  │   └── package.json                                                      │
│  │                                                                         │
│  ├── relayer/                         # Relayer 服务                       │
│  │   ├── src/                                                              │
│  │   │   └── main.zig                 # 用 Zig 写的轻量 relayer           │
│  │   └── build.zig                                                         │
│  │                                                                         │
│  ├── tests/                           # 测试                               │
│  │   ├── circuit_test.js              # 电路单元测试                       │
│  │   ├── integration_test.zig         # 集成测试                           │
│  │   └── fixtures/                    # 测试数据                           │
│  │                                                                         │
│  ├── docs/                            # 文档                               │
│  │   ├── architecture.md                                                   │
│  │   └── api.md                                                            │
│  │                                                                         │
│  └── README.md                                                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 18.49.8 实现路线图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    隐私 AMM 实现路线图                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Phase 1: 电路开发 (Week 1)                                                 │
│  ════════════════════════════                                               │
│                                                                             │
│  ☐ 复用 privacy-cash 的 merkle/nullifier 电路                              │
│  ☐ 扩展支持多资产 UTXO (asset_id 字段)                                     │
│  ☐ 实现 private_swap.circom                                                │
│  ☐ 编写电路单元测试                                                        │
│  ☐ 执行 trusted setup (或复用 Powers of Tau)                               │
│  ☐ 生成 .wasm 和 .zkey                                                     │
│                                                                             │
│  Phase 2: Solana 程序 (Week 1-2)                                            │
│  ══════════════════════════════                                             │
│                                                                             │
│  ☐ 用 solana-zig-sdk 实现 Verifier Program                                 │
│  ☐ 实现链上 Merkle 树 (增量更新)                                           │
│  ☐ 实现 Nullifier Set (使用 Solana Account 作为 bitmap)                    │
│  ☐ 实现 AMM Pool 状态管理                                                  │
│  ☐ 部署到 devnet 测试                                                      │
│                                                                             │
│  Phase 3: CLI 开发 (Week 2)                                                 │
│  ═════════════════════════                                                  │
│                                                                             │
│  ☐ 实现 titan swap 命令                                                    │
│  ☐ 实现 titan deposit 命令                                                 │
│  ☐ 实现 titan withdraw 命令                                                │
│  ☐ 实现 titan balance 命令                                                 │
│  ☐ 集成 snarkjs 调用                                                       │
│  ☐ 实现 UTXO 本地存储/索引                                                 │
│                                                                             │
│  Phase 4: Relayer & 集成 (Week 3)                                           │
│  ═══════════════════════════════                                            │
│                                                                             │
│  ☐ 实现简单的 Relayer 服务                                                 │
│  ☐ 端到端集成测试                                                          │
│  ☐ 性能优化 (证明生成时间)                                                 │
│  ☐ 安全审计 checklist                                                      │
│  ☐ 文档完善                                                                │
│                                                                             │
│  可选扩展:                                                                  │
│  ══════════                                                                 │
│                                                                             │
│  ☐ 添加流动性 (private_add_liquidity.circom)                               │
│  ☐ 移除流动性 (private_remove_liquidity.circom)                            │
│  ☐ 前端 UI (隐私钱包)                                                      │
│  ☐ 多 hop 路由 (跨多个池的 swap)                                          │
│                                                                             │
│  里程碑:                                                                    │
│  ══════════                                                                 │
│                                                                             │
│  Week 1: 电路测试通过，可生成有效证明                                      │
│  Week 2: Solana 程序部署，验证证明成功                                     │
│  Week 3: CLI 完整可用，完成首次隐私 swap                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 18.49.9 技术复用分析

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    技术复用矩阵                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  复用 privacy-cash-sdk:                                                     │
│  ══════════════════════                                                     │
│                                                                             │
│  ┌───────────────────────────┬───────────┬───────────────────────────────┐ │
│  │ 组件                      │ 复用程度  │ 说明                          │ │
│  ├───────────────────────────┼───────────┼───────────────────────────────┤ │
│  │ Poseidon 哈希实现        │ 100%      │ 直接使用                      │ │
│  │ Merkle 树电路            │ 100%      │ 直接 include                  │ │
│  │ Nullifier 计算           │ 100%      │ 直接 include                  │ │
│  │ Groth16 验证密钥生成     │ 80%       │ 需重新 setup (不同电路)       │ │
│  │ UTXO 数据结构            │ 90%       │ 扩展 asset_id 字段            │ │
│  │ snarkjs 集成模式         │ 100%      │ 相同调用方式                  │ │
│  └───────────────────────────┴───────────┴───────────────────────────────┘ │
│                                                                             │
│  复用 Titan 现有组件:                                                       │
│  ══════════════════════                                                     │
│                                                                             │
│  ┌───────────────────────────┬───────────┬───────────────────────────────┐ │
│  │ 组件                      │ 复用程度  │ 说明                          │ │
│  ├───────────────────────────┼───────────┼───────────────────────────────┤ │
│  │ solana-program-sdk-zig   │ 100%      │ 链上程序基础                  │ │
│  │ titan-cli 框架           │ 80%       │ 新增 swap/deposit 命令        │ │
│  │ Zig 构建系统             │ 100%      │ 统一 build.zig                │ │
│  │ 测试框架                 │ 90%       │ 扩展 ZK 测试 helpers          │ │
│  └───────────────────────────┴───────────┴───────────────────────────────┘ │
│                                                                             │
│  新增开发量:                                                                │
│  ══════════                                                                 │
│                                                                             │
│  ┌───────────────────────────┬───────────┬───────────────────────────────┐ │
│  │ 组件                      │ 代码量    │ 复杂度                        │ │
│  ├───────────────────────────┼───────────┼───────────────────────────────┤ │
│  │ private_swap.circom      │ ~300 行   │ 中 (AMM 约束)                │ │
│  │ verifier.zig (链上)      │ ~500 行   │ 中 (BN254 操作)              │ │
│  │ swap.zig (CLI)           │ ~400 行   │ 低 (调用封装)                │ │
│  │ pool.zig (链上)          │ ~300 行   │ 低 (状态管理)                │ │
│  │ relayer 服务             │ ~200 行   │ 低 (HTTP 转发)               │ │
│  ├───────────────────────────┼───────────┼───────────────────────────────┤ │
│  │ 总计                      │ ~1700 行  │                               │ │
│  └───────────────────────────┴───────────┴───────────────────────────────┘ │
│                                                                             │
│  结论: 大量复用现有基础设施，新增开发量仅 ~1700 行                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 18.49.10 与 Titan 框架的关系

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    隐私 AMM 在 Titan 生态中的位置                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Titan Framework 全景图:                                                    │
│  ══════════════════════                                                     │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                                                                     │   │
│  │                         Titan Framework                            │   │
│  │                                                                     │   │
│  │  ┌───────────────┬───────────────┬───────────────┬──────────────┐ │   │
│  │  │               │               │               │              │ │   │
│  │  │  Solana SBF   │   EVM/Yul     │   Noir (ZK)   │   Wasm      │ │   │
│  │  │   Backend     │   Backend     │   Backend     │   Backend   │ │   │
│  │  │               │               │               │              │ │   │
│  │  │  solana-zig   │   zig-to-yul  │  zig-to-noir  │   zig-wasm  │ │   │
│  │  │               │               │   (规划中)    │   (规划中)   │ │   │
│  │  │               │               │               │              │ │   │
│  │  └───────────────┴───────────────┴───────────────┴──────────────┘ │   │
│  │                              │                                     │   │
│  │                              ▼                                     │   │
│  │                    ┌─────────────────┐                            │   │
│  │                    │                 │                            │   │
│  │                    │   Zig 源码      │                            │   │
│  │                    │                 │                            │   │
│  │                    └─────────────────┘                            │   │
│  │                              │                                     │   │
│  │  ┌───────────────────────────┴───────────────────────────┐       │   │
│  │  │                                                       │       │   │
│  │  │                    应用层产品                         │       │   │
│  │  │                                                       │       │   │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │       │   │
│  │  │  │             │  │             │  │             │  │       │   │
│  │  │  │ Titan Perp  │  │  Privacy    │  │   未来...   │  │       │   │
│  │  │  │  Exchange   │  │    AMM      │  │             │  │       │   │
│  │  │  │             │  │  ◄── HERE   │  │             │  │       │   │
│  │  │  └─────────────┘  └─────────────┘  └─────────────┘  │       │   │
│  │  │                                                       │       │   │
│  │  └───────────────────────────────────────────────────────┘       │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  隐私 AMM 的战略意义:                                                       │
│  ══════════════════════                                                     │
│                                                                             │
│  1. 验证 Titan + ZK 的技术可行性                                           │
│     • 证明 Zig 生态可以与 ZK 电路集成                                      │
│     • 为未来 zig-to-noir 积累经验                                          │
│                                                                             │
│  2. 提供实际产品价值                                                        │
│     • 隐私 DEX 是真实市场需求                                              │
│     • 差异化竞争 (vs 透明的 Jupiter/Raydium)                               │
│                                                                             │
│  3. 展示框架能力                                                            │
│     • 端到端产品: CLI → 电路 → 链上程序                                   │
│     • 复杂业务逻辑: AMM + ZK + 隐私                                        │
│                                                                             │
│  4. 为 Hackathon 提供完整 Demo                                              │
│     • Solana Privacy Hackathon 的参赛作品                                  │
│     • 展示 Titan 框架的独特价值                                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 18.49.11 总结

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│                    Privacy-Cash SDK 集成 - 总结                             │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  核心策略:                                                                  │
│  ══════════                                                                 │
│                                                                             │
│  基于 privacy-cash-sdk 现有基础设施，扩展实现隐私 AMM 功能                │
│                                                                             │
│  复用:                                                                      │
│  • Poseidon 哈希                                                           │
│  • Merkle 树电路                                                           │
│  • Nullifier 机制                                                          │
│  • snarkjs 证明系统                                                        │
│                                                                             │
│  新增:                                                                      │
│  • private_swap.circom (AMM 约束)                                          │
│  • 多资产 UTXO 支持                                                        │
│  • Titan CLI swap 命令                                                     │
│  • 链上 AMM 池状态                                                         │
│                                                                             │
│  工作量估算:                                                                │
│  ══════════════                                                             │
│                                                                             │
│  ┌────────────────────┬───────────────┐                                    │
│  │ 组件               │ 新增代码量    │                                    │
│  ├────────────────────┼───────────────┤                                    │
│  │ Circom 电路        │ ~300 行       │                                    │
│  │ Zig 链上程序       │ ~800 行       │                                    │
│  │ Zig CLI            │ ~400 行       │                                    │
│  │ Relayer            │ ~200 行       │                                    │
│  ├────────────────────┼───────────────┤                                    │
│  │ 总计               │ ~1700 行      │                                    │
│  └────────────────────┴───────────────┘                                    │
│                                                                             │
│  实现周期: 2-3 周                                                           │
│                                                                             │
│  产品价值:                                                                  │
│  ══════════                                                                 │
│                                                                             │
│  • 首个 Solana 上的隐私 AMM                                                │
│  • 用户可隐私交换任意 SPL Token                                            │
│  • 交易金额、方向、身份完全隐藏                                            │
│  • CLI 一行命令完成隐私 swap                                               │
│                                                                             │
│  下一步:                                                                    │
│  ══════════                                                                 │
│                                                                             │
│  1. 开始 private_swap.circom 开发                                          │
│  2. 设置 trusted setup 环境                                                │
│  3. 用 solana-zig-sdk 实现 Verifier                                        │
│  4. 集成测试并准备 Hackathon 演示                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 相关文档

| 文档 | 说明 |
| :--- | :--- |
| [system_overview.md](system_overview.md) | 系统概览 |
| [kernel_abstraction_model.md](kernel_abstraction_model.md) | 内核抽象模型详细设计 |
| [why_zig.md](why_zig.md) | 为什么选择 Zig |
| [business_vision.md](business_vision.md) | 商业愿景 |
| [competitive_analysis.md](competitive_analysis.md) | 竞品分析 |

---

*Titan Framework - The Verifiable Web3 Operating System*

*Version 1.0.0 | January 2026*
