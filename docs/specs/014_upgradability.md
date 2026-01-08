# 规范 014: 合约升级机制 (Upgradability)

本规范定义了 Titan OS 上的合约升级标准。目标是在保持去中心化的前提下，提供代码修复路径。

## 1. 升级模型 (The Upgrade Model)

Titan OS 推荐 **"Proxy Pattern" (代理模式)** 的变体，或利用底层链原生的升级能力。

### 1.1 Solana (原生升级)
Solana 的 BPF Loader 内置了升级机制。
*   **Authority**: 合约拥有者（Upgrade Authority）。
*   **操作**: `solana program deploy --program-id <ID>`。
*   **Titan 支持**: Titan CLI 提供 `titan upgrade` 命令，封装了 buffer 写入和 atomic switch 过程。

### 1.2 Near (DAO 升级)
Near 合约可以将自身代码替换为新的 Wasm blob。
*   **实现**: Titan 标准库提供 `titan.admin.update_code(code: []u8)`。
*   **权限**: 通常限制为 DAO 账户调用。

### 1.3 状态迁移 (State Migration)
升级最痛的点是**旧数据结构不兼容新代码**。Titan OS 引入 **Schema Versioning**。

```zig
const StateV1 = struct { val: u64 };
const StateV2 = struct { val: u64, extra: u8 };

pub fn migrate() !void {
    const v1 = load_v1();
    const v2 = StateV2 { .val = v1.val, .extra = 0 };
    save_v2(v2);
}
```

Titan 内核会在升级后的第一次调用时，自动检查版本号并触发 `migrate` 钩子（如果开发者定义了的话）。

## 2. 紧急暂停 (Emergency Pause)

所有 Titan 合约可选集成 `Pausable` 模块。

```zig
// 在关键函数前检查
try titan.admin.require_not_paused();
```

*   **Solana**: 检查一个特定的 Config Account。
*   **Near**: 检查合约状态中的 boolean 标志。
