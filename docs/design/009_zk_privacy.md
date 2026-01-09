# 设计 009: 零知识隐私架构 (ZK Privacy Architecture)

> 状态: 规划中 (V3 Target)
> 目标: 为 Titan OS 提供原生的隐私计算能力，使开发者能够轻松构建隐私 DeFi 和匿名投票应用。

**设计原则**: ZK 证明作为资源 IO 的安全扩展，不改变核心 IO 语义。

## 1. 设计哲学 (Philosophy)

Titan OS 不做复杂的电路生成器（Circuit Generator）。我们将 ZK 视为一种 **"Off-chain Compute, On-chain Verify" (链下计算，链上验证)** 的扩展能力。

Titan OS 的核心职责是提供**极致高效的链上验证器**。

## 2. 架构分层

### 2.1 链下 (Off-Chain): 电路层
用户使用成熟的工具栈（Circom, Halo2, Noir）编写电路。
Titan CLI 提供插件，将电路的 Verification Key (VK) 编译为 Zig 常量。

```bash
titan zk compile --circuit my_circuit.circom --output src/verifier.zig
```

### 2.2 链上 (On-Chain): 验证层
Titan 标准库 `titan.zk` 提供通用的验证原语。

```zig
// 验证一个 Groth16 证明
const is_valid = try titan.zk.groth16.verify(
    verifier_key,
    public_inputs,
    proof
);
```

## 3. 底层适配 (Backend Adapters)

不同的链对密码学曲线的支持不同。Titan 必须抹平差异。

| 曲线 (Curve) | Solana 实现 | Near 实现 | EVM (Stylus) 实现 | Titan 策略 |
| :--- | :--- | :--- | :--- | :--- |
| **BN254** | `sol_alt_bn128` (Syscall) | `alt_bn128` (Host Func) | Precompile 0x06/0x07/0x08 | **原生支持** (零开销) |
| **BLS12-381** | `sol_poseidon` (部分支持) | `bls12381` (Host Func) | 无 Precompile (需软实现) | **混合支持** (优先 Syscall，降级为 Wasm 软实现) |

## 4. API 设计 (`titan.zk`)

```zig
pub const ZkProof = struct {
    a: [2]u256,
    b: [2][2]u256,
    c: [2]u256,
};

pub fn verify(proof: ZkProof, inputs: []const u256) !bool;
```

## 5. 隐私代币标准 (Confidential Token)

基于 ZK 能力，Titan OS V3 将推出 **Titan Privacy Token (TPT)** 标准。
*   余额加密 (ElGamal)。
*   转账使用 ZK 证明 (类似 ZCash/Tornado)。
*   合规接口 (View Key for Auditors)。

这是一套开箱即用的隐私方案，开发者无需懂 ZK 即可发行隐私币。
