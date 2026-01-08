# 设计 002: 驱动模型 (Driver Model)

> 状态: 草稿
> 关联规范: [规范 002: 内核接口](../specs/002_kernel_interface.md)

## 1. 概述 (Overview)

Titan OS 的内核层 (`kernel/`) 提供了最小公分母（日志、内存）。然而，不同的区块链拥有独特的“硬件特性”：
*   **Solana**: 跨程序调用 (CPI)、账户数据 (Account Info)、Sysvar。
*   **Near**: 异步 Promise、分片数据。
*   **Arbitrum Stylus**: EVM 宿主方法、以太坊存储槽。

我们需要一个 **驱动模型 (Driver Model)**，允许在不污染核心内核的情况下，扩展对这些特性的支持。

## 2. 架构设计

Titan OS 采用 **"Microkernel + Drivers" (微内核 + 驱动)** 的架构。

```text
src/
├── kernel/             # 微内核 (Logs, Mem, Panic)
└── drivers/            # 驱动层
    ├── solana/         # Solana 驱动
    │   ├── cpi.zig     # 跨程序调用
    │   └── accounts.zig# 账户解析
    ├── near/           # Near 驱动
    │   └── promise.zig # 异步调用
    └── evm/            # EVM 驱动 (Stylus)
        └── storage.zig # 槽位存取
```

## 3. 驱动接口 (Driver Interface)

驱动不仅仅是库，它们必须遵循统一的初始化和调用约定。

### 3.1 显式引入

用户在 `build.zig` 中选择目标链时，构建系统会自动链接对应的驱动。但在代码中，用户通过 `titan.driver` 访问特定功能。

```zig
const titan = @import("titan");

pub fn main() !void {
    // 1. 通用操作 (内核)
    titan.log("Hello");

    // 2. 特定操作 (驱动)
    if (titan.config.chain == .solana) {
        const sol = titan.driver.solana;
        // 调用 Solana 特有的 CPI
        try sol.invoke_signed(...);
    }
}
```

### 3.2 驱动能力查询 (Capability Query)

为了支持跨链代码复用，驱动模型应支持编译时能力查询。

```zig
if (titan.driver.has_feature(.async_promise)) {
    // 这段代码只会在 Near/Polkadot 上编译
    titan.driver.promise.create(...);
} else {
    // 回退逻辑
}
```

## 4. 核心驱动模块

### 4.1 Solana 驱动 (`drivers/solana`)
*   **AccountInfo 解析器**: 高效解析序列化的账户数组。
*   **CPI 封装**: 封装 `sol_invoke`，自动处理指令序列化。
*   **PDA 助手**: `find_program_address` 的 Zig 实现。

### 4.2 Near 驱动 (`drivers/near`)
*   **Register API**: 封装 Near 的寄存器读写 (为了减少 Wasm 内存拷贝，Near 大量使用寄存器)。
*   **Promise API**: 封装 `promise_create`, `promise_then`。

### 4.3 Stylus 驱动 (`drivers/stylus`)
*   **EVM Storage**: 提供 `sload` / `sstore` 的封装。
*   **Msg Context**: 获取 `msg.sender`, `msg.value`。

## 5. 实现策略

1.  **条件编译**: 使用 `comptime` 检查 `target_chain`，仅编译相关的驱动代码。
2.  **零开销抽象**: 驱动层应尽可能使用 `inline fn`，确保编译后直接展开为底层 syscall，无函数调用开销。
