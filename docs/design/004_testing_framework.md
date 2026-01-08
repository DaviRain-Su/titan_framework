# 设计 004: 测试框架 (Testing Framework)

> 状态: 草稿

## 1. 概述 (Overview)

Titan OS 旨在提供 **"Local First" (本地优先)** 的开发体验。这意味着开发者应该能在不连接任何真实区块链的情况下，运行 99% 的逻辑测试。

为此，我们设计了 **Titan Mock Runtime**。

## 2. 架构设计

### 2.1 运行时模拟 (Runtime Emulation)

我们在 `src/arch/mock/` 下实现了一套纯 Zig 的内核后端。

*   **内存**: 使用宿主机的 RAM 模拟链上堆。
*   **Syscalls**:
    *   `log` -> 打印到终端 stdout。
    *   `storage_read/write` -> 读写本地的 `HashMap`。
    *   `block_height` -> 返回可配置的模拟值。

### 2.2 单元测试体验

开发者可以直接在 Zig 文件中编写 `test` 块：

```zig
test "transfer logic" {
    // 1. 初始化 Mock 环境
    var runtime = titan.testing.Runtime.init();
    defer runtime.deinit();

    // 2. 预设状态
    runtime.set_balance(alice, 100);

    // 3. 调用合约逻辑
    try my_contract.transfer(ctx, alice, bob, 50);

    // 4. 断言结果
    try std.testing.expectEqual(50, runtime.get_balance(alice));
}
```

## 3. 集成测试 (Scenario Testing)

除了单元测试，我们还需要支持多合约交互的场景测试。

*   **Bank 模拟**: 模拟代币发行和转账。
*   **CPI 模拟**: 当合约 A 调用合约 B 时，Mock Runtime 能够拦截调用，并执行合约 B 的逻辑（如果 B 也在本地代码中），或者返回预设的 Mock 结果。

## 4. 模糊测试 (Fuzzing)

利用 Zig 强大的 `std.testing.fuzz` 能力。

*   **策略**: 自动生成随机的交易输入序列。
*   **目标**: 发现溢出、Panic 或状态不一致。
*   **CI 集成**: 每次提交代码时自动运行 Fuzz 测试。

## 5. 链上分叉测试 (Fork Testing) - 阶段 3

未来我们将支持从 Mainnet 拉取真实账户数据到本地 Mock Runtime 中，实现类似 Foundry 的 Fork Testing。
