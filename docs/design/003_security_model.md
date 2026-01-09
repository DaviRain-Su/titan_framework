# 设计 003: 安全模型 (Security Model)

> 状态: 草稿

**设计原则**: 安全策略围绕资源访问边界定义，确保 IO 操作默认安全。

## 1. 概述 (Overview)

Titan OS 的安全哲学是 **"Secure by Default" (默认安全)**。我们利用 Zig 的类型系统和编译时检查，在架构层面消除一整类常见的智能合约漏洞。

## 2. 内存安全 (Memory Safety)

### 2.1 越界访问 (Out-of-Bounds)
*   **机制**: Zig 默认在 Debug 和 ReleaseSafe 模式下启用运行时边界检查。
*   **Titan 策略**:
    *   在开发阶段强制开启检查。
    *   提供 `titan.utils.checked_slice`，即使在 ReleaseFast 模式下也强制检查关键数据的边界。

### 2.2 内存泄漏与 Use-After-Free
*   **机制**: Titan OS 采用 **Arena 模型** 管理交易内存。
*   **策略**:
    *   每个交易创建一个 Arena。
    *   交易结束时，Arena 整体销毁。
    *   **结果**: 彻底消除了内存泄漏的可能性，且极大地简化了 Use-After-Free 的防护（因为生命周期统一）。

## 3. 算术安全 (Arithmetic Safety)

### 3.1 溢出保护
*   **问题**: 整数溢出是 DeFi 合约的头号杀手。
*   **Titan 策略**:
    *   `titan.math` 库中的所有操作 (`add`, `sub`, `mul`) 默认都是 **Checked** (带检查的)。
    *   溢出将导致 Panic 并回滚交易。
    *   提供 `wrapping_add` 和 `saturating_add` 供明确需要特殊行为的场景使用，但必须显式调用。

## 4. 权限与鉴权 (Authorization)

### 4.1 Signer 强类型
*   **问题**: 开发者忘记检查 `is_signer` 标志。
*   **Titan 策略**: 引入 **Phantom Type (幽灵类型)**。

```zig
// 定义一个必须是 Signer 的类型
pub const Signer = struct {
    address: Address,
    // 该字段是私有的，只能通过校验函数构造出来
    _verified: void = {},
};

// 只有通过校验函数才能拿到 Signer 对象
pub fn verify_signer(account: AccountInfo) !Signer {
    if (!account.is_signer) return error.MissingSignature;
    return Signer { .address = account.key };
}

// 敏感操作强制要求 Signer 类型参数
pub fn transfer(from: Signer, to: Address, amount: u64) !void { ... }
```

**结果**: 如果开发者忘记校验签名，代码**无法通过编译**。

## 5. 重入保护 (Reentrancy Protection)

### 5.1 同步环境 (Solana)
*   **机制**: 使用临时内存 (Instruction-scoped memory) 或 Transient Storage (如果可用)。
*   **实现**: `var lock = try Mutex.acquire(); defer lock.release();`

### 5.2 异步环境 (Near/TON) - **关键修正**
*   **问题**: 异步调用跨越多个区块，内存锁无效。
*   **机制**: 必须使用 **持久化存储 (Storage)** 作为锁的载体。
*   **实现**: `titan.security.AsyncGuard`。
    1.  `acquire()`: 写入 Storage Key `IS_LOCKED = true`。
    2.  发起异步调用。
    3.  在回调函数中 `release()`: 写入 `IS_LOCKED = false`。
*   **死锁风险**: 如果异步调用失败且未触发回调，锁将永远无法释放。
*   **超时机制**: AsyncGuard 必须包含 `timeout` 字段。如果当前时间超过 `lock_time + timeout`，允许强制覆盖锁。

## 6. 供应链安全
*   **锁定依赖**: 强制使用 `build.zig.zon` 锁定所有依赖库的哈希值。
*   **审计模式**: 提供 `zig build -Daudit=true`，输出代码的控制流图 (CFG) 和潜在的风险点报告。
