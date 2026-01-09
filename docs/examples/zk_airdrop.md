# 示例: 隐私空投 (ZK Airdrop)

> 目标: 展示 Titan OS 中 `Context` 与 `ZK` 模块的无缝集成。

## 1. 电路定义 (Circuit Definition)

首先，用户使用 Zig 编写 ZK 电路。这就是 Titan ZK DSL。

```zig
// src/circuits.zig
const std = @import("std");
const zk = @import("titan.zk");

/// @zk_circuit
/// 验证用户提交的 Nullifier Hash 是否由 Merkle Root 中的某个私钥生成。
pub fn verify_eligibility(
    root: zk.Field,       // 公开输入: Merkle Root
    nullifier: zk.Field,  // 公开输入: 防止双花
    secret: zk.Field,     // 私有输入: 用户私钥
    path: [10]zk.Field    // 私有输入: Merkle Path
) bool {
    // 1. 验证私钥派生出的 Nullifier
    const derived_nullifier = zk.hash(secret);
    zk.assert(derived_nullifier == nullifier);

    // 2. 验证 Merkle Proof
    const computed_root = zk.merkle.verify_proof(path, secret);
    return computed_root == root;
}

// 显式导出电路
pub const __titan_zk_circuits = .{
    .eligibility = verify_eligibility,
};
```

## 2. 合约逻辑 (Contract Logic)

接下来，用户编写主合约。注意 `Context` 和自动生成的验证器的配合。

```zig
// src/main.zig
const std = @import("std");
const titan = @import("titan");
// 导入自动生成的验证器模块
const verifier = @import("generated/verifier.zig");

// 定义状态
const State = struct {
    merkle_root: u256,
    nullifiers: titan.collections.HashMap(u256, bool),
};

// 定义入口参数
const ClaimArgs = struct {
    nullifier: u256,
    proof: []const u8, // ZK Proof 字节流
};

/// 领取空投
pub fn claim(ctx: titan.Context, args: ClaimArgs) !void {
    // 1. 加载状态
    var state = ctx.storage.load(State);

    // 2. 检查双花 (Nullifier 必须未被使用)
    if (state.nullifiers.contains(args.nullifier)) {
        return error.AlreadyClaimed;
    }

    // 3. 验证 ZK 证明
    // 注意: 这里调用的是自动生成的验证器，它也是 Zig 代码！
    try verifier.eligibility.verify(.{
        .root = state.merkle_root,
        .nullifier = args.nullifier,
        .proof = args.proof,
    });

    // 4. 标记已领 (防重放)
    try state.nullifiers.put(args.nullifier, true);
    ctx.storage.save(state);

    // 5. 发放代币
    try titan.token.transfer(.{
        .to = ctx.sender,
        .amount = 100,
        .token = titan.token.NATIVE,
    });
    
    titan.log("Airdrop claimed successfully!");
}
```

## 3. 体验总结

1.  **统一语言**: 从电路到合约，全是 Zig。没有 `.circom`，没有 `.sol`。
2.  **类型安全**: `verifier.eligibility.verify` 的参数是强类型的。如果电路改了，合约编译会报错。
3.  **OS 抽象**: `titan.token.transfer` 在 Near 上是 Promise，在 Solana 上是 CPI，用户完全无感。

这就是 Titan OS 的终极体验。
