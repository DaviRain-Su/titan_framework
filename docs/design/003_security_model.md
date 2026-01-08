# 设计 003: 安全模型 (Security Model)

> 状态: 草稿

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

### 5.1 互斥锁 (Mutex)
*   Titan 内核提供轻量级的 `ReentrancyGuard`。
*   利用底层链的临时存储（如 Solana 的 Transaction scoped memory）设置标志位。

```zig
pub fn withdraw() !void {
    var guard = try titan.security.ReentrancyGuard.acquire();
    defer guard.release();

    // 业务逻辑...
}
```

## 6. 供应链安全
*   **锁定依赖**: 强制使用 `build.zig.zon` 锁定所有依赖库的哈希值。
*   **审计模式**: 提供 `zig build -Daudit=true`，输出代码的控制流图 (CFG) 和潜在的风险点报告。
