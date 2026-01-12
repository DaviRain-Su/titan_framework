# 设计 012: ZK 计算层架构 (ZK Compute Layer)

> 状态: 规划中 (V3+ Target)
> 核心愿景: **链下执行 + 链上验证 = 传统互联网应用体验**

## 1. 问题陈述

当前区块链应用面临的核心困境：

| 问题 | 传统互联网 | 当前区块链 |
| :--- | :--- | :--- |
| **响应速度** | 毫秒级 | 秒级到分钟级 |
| **执行成本** | 几乎为零 | 每次交易收费 (Gas) |
| **吞吐量** | 百万 TPS | 数百到数千 TPS |
| **用户体验** | 即时反馈 | 等待确认 |

**根本原因**: 所有计算都在链上执行，每个节点都要重复计算。

## 2. 解决方案: ZK Compute Layer

### 2.1 核心思想

> **链下执行，链上验证。**

- **链下**: 业务逻辑在链下执行，任何人都可以运行执行器
- **链上**: 只需验证 ZK proof，确认链下执行的正确性
- **结果**: 链上成本降低 99%+，用户体验接近传统互联网

### 2.2 架构总览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Titan ZK Compute Layer                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   用户交互                                                               │
│       │                                                                 │
│       ▼                                                                 │
│   ┌──────────────────────────────────────────────────────────────────┐ │
│   │                    链下执行层 (Off-Chain)                         │ │
│   │  ┌────────────┐   ┌────────────┐   ┌─────────────────────────┐  │ │
│   │  │ Zig 业务   │ → │ Titan      │ → │   ZK Proof Generator    │  │ │
│   │  │ 逻辑代码   │   │ Runtime    │   │   (Noir/RISC0/SP1)      │  │ │
│   │  └────────────┘   └────────────┘   └─────────────────────────┘  │ │
│   │       │                │                      │                  │ │
│   │       │           执行轨迹              ZK Proof                 │ │
│   │       │           (Trace)                    │                   │ │
│   │       ▼                ▼                      ▼                  │ │
│   │  ┌─────────────────────────────────────────────────────────────┐│ │
│   │  │              状态差分 (State Diff) + Proof                  ││ │
│   │  └─────────────────────────────────────────────────────────────┘│ │
│   └──────────────────────────────────────────────────────────────────┘ │
│                                    │                                    │
│                                    ▼                                    │
│   ┌──────────────────────────────────────────────────────────────────┐ │
│   │                     链上验证层 (On-Chain)                         │ │
│   │  ┌────────────────────────────────────────────────────────────┐  │ │
│   │  │              Solana ZK Verifier Program                     │  │ │
│   │  │  1. 验证 ZK Proof                                           │  │ │
│   │  │  2. 应用 State Diff                                         │  │ │
│   │  │  3. 更新链上状态                                             │  │ │
│   │  └────────────────────────────────────────────────────────────┘  │ │
│   └──────────────────────────────────────────────────────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 3. 核心组件

### 3.1 Titan Runtime (链下执行器)

链下执行器是一个独立的程序，负责执行用户的业务逻辑。

**特点**:
- **任何人可运行**: 去中心化，无需许可
- **确定性执行**: 相同输入必产生相同输出
- **执行轨迹记录**: 记录所有状态变更，用于生成 proof

```zig
// titan_runtime/main.zig

const std = @import("std");
const titan = @import("titan");

pub fn main() !void {
    // 1. 加载初始状态 (从链上或本地缓存)
    var state = try loadState();

    // 2. 读取用户交易
    const txs = try readPendingTransactions();

    // 3. 执行交易，记录轨迹
    var trace = titan.zk.Trace.init();
    for (txs) |tx| {
        try executeTransaction(&state, tx, &trace);
    }

    // 4. 输出状态差分 + 执行轨迹
    const state_diff = state.computeDiff();
    try outputForProver(state_diff, trace);
}
```

### 3.2 ZK Prover (证明生成器)

将执行轨迹转换为 ZK Proof。

**支持的后端**:

| 后端 | 特点 | 适用场景 |
| :--- | :--- | :--- |
| **Noir (Aztec)** | 易用，Solidity 友好 | 通用逻辑 |
| **RISC Zero** | zkVM，支持任意 Rust | 复杂计算 |
| **SP1 (Succinct)** | 高性能 zkVM | 高吞吐量 |
| **Plonky3** | 极快证明生成 | 实时应用 |

**架构决策**: Titan 采用**插件化 Prover 架构**，不绑定特定 ZK 系统。

```zig
// titan_prover/main.zig

pub const ProverBackend = enum {
    noir,
    risc_zero,
    sp1,
    plonky3,
};

pub fn generateProof(
    trace: Trace,
    backend: ProverBackend,
) !Proof {
    return switch (backend) {
        .noir => noir_backend.prove(trace),
        .risc_zero => risc0_backend.prove(trace),
        .sp1 => sp1_backend.prove(trace),
        .plonky3 => plonky3_backend.prove(trace),
    };
}
```

### 3.3 On-Chain Verifier (链上验证器)

部署在 Solana 上的程序，负责验证 proof 并更新状态。

```zig
// programs/zk_verifier/main.zig

const titan = @import("titan");

pub const VerifyArgs = struct {
    proof: []const u8,
    public_inputs: PublicInputs,
    state_diff: StateDiff,
};

pub const PublicInputs = struct {
    old_state_root: [32]u8,
    new_state_root: [32]u8,
    transactions_hash: [32]u8,
};

/// 链上入口点
pub fn verify_and_apply(ctx: titan.Context, args: VerifyArgs) !void {
    // 1. 验证当前状态根
    const current_root = ctx.storage.get("state_root");
    if (!std.mem.eql(u8, &current_root, &args.public_inputs.old_state_root)) {
        return error.StateRootMismatch;
    }

    // 2. 验证 ZK Proof
    const is_valid = try titan.zk.verify(
        args.proof,
        args.public_inputs,
    );
    if (!is_valid) {
        return error.InvalidProof;
    }

    // 3. 应用状态差分
    try applyStateDiff(ctx, args.state_diff);

    // 4. 更新状态根
    try ctx.storage.set("state_root", args.public_inputs.new_state_root);

    titan.log("State transition verified and applied");
}
```

## 4. 编译模式

**同一份 Zig 代码，支持两种编译模式**:

```bash
# 模式 1: 传统链上执行 (开发/测试/小规模)
zig build -Dtarget_chain=solana
# 输出: program.so (直接部署到 Solana)

# 模式 2: 链下执行 + ZK (生产/大规模)
zig build -Dtarget_chain=zk_compute -Dzk_backend=risc_zero
# 输出:
#   - runtime (链下执行器)
#   - prover_circuit (ZK 电路)
#   - verifier.so (链上验证器)
```

### 4.1 代码复用策略

```zig
// src/contract.zig - 用户业务逻辑

const titan = @import("titan");

pub const State = struct {
    balances: titan.Map(Address, u64),
    total_supply: u64,
};

/// 转账逻辑 - 链上/链下复用
pub fn transfer(ctx: *titan.Context, from: Address, to: Address, amount: u64) !void {
    var state = try ctx.load(State);

    const from_balance = state.balances.get(from) orelse 0;
    if (from_balance < amount) return error.InsufficientBalance;

    try state.balances.put(from, from_balance - amount);

    const to_balance = state.balances.get(to) orelse 0;
    try state.balances.put(to, to_balance + amount);

    try ctx.save(state);
}
```

**编译时差异**:

| 模式 | `ctx.load` 行为 | `ctx.save` 行为 |
| :--- | :--- | :--- |
| **链上** | 读 Solana Account Data | 写 Solana Account Data |
| **链下** | 读本地状态 + 记录轨迹 | 写本地状态 + 记录轨迹 |

## 5. 工作流程

### 5.1 完整流程

```
用户                 链下执行器              ZK Prover             Solana 链上
 │                      │                      │                      │
 │  1. 发送交易请求     │                      │                      │
 │─────────────────────>│                      │                      │
 │                      │                      │                      │
 │                      │  2. 执行业务逻辑     │                      │
 │                      │  (本地状态更新)      │                      │
 │                      │                      │                      │
 │  3. 立即返回结果     │                      │                      │
 │<─────────────────────│                      │                      │
 │  (乐观确认)          │                      │                      │
 │                      │                      │                      │
 │                      │  4. 批量聚合交易     │                      │
 │                      │  输出执行轨迹        │                      │
 │                      │─────────────────────>│                      │
 │                      │                      │                      │
 │                      │                      │  5. 生成 ZK Proof   │
 │                      │                      │  (可能需要数秒)      │
 │                      │                      │                      │
 │                      │                      │  6. 提交 Proof      │
 │                      │                      │─────────────────────>│
 │                      │                      │                      │
 │                      │                      │      7. 验证 Proof  │
 │                      │                      │      更新链上状态   │
 │                      │                      │                      │
 │  8. 最终确认 (可选)  │                      │                      │
 │<────────────────────────────────────────────────────────────────────│
```

### 5.2 批量聚合

为了进一步降低成本，支持批量聚合多笔交易：

```
交易 1 ─┐
交易 2 ─┼──> 聚合执行 ──> 单个 Proof ──> 单次链上验证
交易 3 ─┘

成本: 原本 3 笔链上交易 → 1 笔链上验证
```

## 6. 状态管理

### 6.1 状态树结构

```
                    State Root
                        │
            ┌───────────┼───────────┐
            │           │           │
         Balances    Contracts    Metadata
            │           │           │
         ┌──┴──┐     ┌──┴──┐     ┌──┴──┐
        ...   ...   ...   ...   ...   ...
```

### 6.2 状态差分 (State Diff)

只提交变更的状态，而非完整状态：

```zig
pub const StateDiff = struct {
    /// 变更的键值对
    changes: []const Change,
    /// 新状态根
    new_root: [32]u8,

    pub const Change = struct {
        key: []const u8,
        old_value: ?[]const u8,
        new_value: ?[]const u8,
    };
};
```

### 6.3 数据可用性 (Data Availability)

**方案 A: 完整 DA (推荐)**
- State Diff 完整上链
- 任何人可重建状态
- 成本稍高但安全性最好

**方案 B: 压缩 DA**
- 只上链状态根 + Proof
- State Diff 存储在 DA 层 (Celestia, EigenDA)
- 成本更低但增加依赖

## 7. 安全模型

### 7.1 信任假设

| 组件 | 信任假设 |
| :--- | :--- |
| **链下执行器** | 不信任（任何人可验证） |
| **ZK Prover** | 不信任（数学保证正确性） |
| **链上 Verifier** | 信任 Solana 共识 |

### 7.2 攻击向量与防御

| 攻击 | 防御 |
| :--- | :--- |
| **伪造执行结果** | ZK Proof 数学保证无法伪造 |
| **重放攻击** | 交易序号 + 状态根校验 |
| **DoS 执行器** | 多个执行器竞争，无单点故障 |
| **Proof 延迟** | 超时机制 + 罚没保证金 |

## 8. 与 Layer 2 的区别

| 特性 | Titan ZK Compute | 传统 zkRollup |
| :--- | :--- | :--- |
| **基础层** | Solana (高性能 L1) | Ethereum (低吞吐 L1) |
| **语言** | Zig (统一) | Solidity + 电路语言 |
| **定位** | 应用框架 | 通用扩容方案 |
| **灵活性** | 同一代码链上/链下切换 | 固定链下执行 |

## 9. 应用场景

### 9.1 高频交易应用

```zig
// 订单簿 DEX - 链下撮合，链上结算
pub fn match_orders(ctx: *titan.Context, orders: []Order) ![]Trade {
    // 链下: 毫秒级撮合
    // 链上: 只验证撮合结果正确性
}
```

### 9.2 游戏应用

```zig
// 链游 - 链下游戏逻辑，链上资产结算
pub fn process_game_turn(ctx: *titan.Context, actions: []PlayerAction) !GameState {
    // 链下: 实时游戏逻辑
    // 链上: 只验证最终结果
}
```

### 9.3 AI/ML 推理

```zig
// AI 模型推理 - 链下计算，链上验证
pub fn verify_inference(ctx: *titan.Context, model_hash: [32]u8, input: []f32, output: []f32) !bool {
    // 链下: 执行 ML 推理
    // 链上: 验证推理过程正确
}
```

## 10. 实现路线图

### Phase 1: 基础设施
- [ ] 设计状态树结构
- [ ] 实现链下 Runtime (Native 执行)
- [ ] 实现执行轨迹记录

### Phase 2: ZK 集成
- [ ] 集成 RISC Zero / SP1 作为首选后端
- [ ] 实现 Solana Verifier Program
- [ ] 端到端 Demo (简单转账)

### Phase 3: 生产化
- [ ] 批量聚合优化
- [ ] DA 层集成
- [ ] 多执行器竞争机制
- [ ] 监控与告警

### Phase 4: 生态扩展
- [ ] SDK 封装 (TypeScript, Python)
- [ ] 区块浏览器集成
- [ ] 开发者文档与教程

## 11. 与现有设计的关系

| 现有设计 | 关系 | 说明 |
| :--- | :--- | :--- |
| **009_zk_privacy** | 互补 | 隐私 ZK 用于身份/资格验证 |
| **zk_airdrop 示例** | 特例 | 本设计的一个应用场景 |
| **多链适配器** | 扩展 | 未来可扩展到其他链的 ZK 验证 |

## 12. 结论

Titan ZK Compute Layer 将区块链应用从"全链上执行"推进到"链下执行+链上验证"范式。

**核心价值**:
1. **用户体验**: 毫秒级响应，接近传统互联网
2. **成本效率**: 链上成本降低 99%+
3. **开发体验**: 同一份 Zig 代码，两种执行模式
4. **去中心化**: 执行器无需许可，任何人可运行

这是 Titan OS 实现"Web3 互联网应用"愿景的关键拼图。
