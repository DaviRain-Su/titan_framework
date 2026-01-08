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

## 3. V1 Mock Runtime API (Critical)

### 3.1 Runtime 结构体

```zig
pub const Runtime = struct {
    /// 模拟的账户存储: pubkey -> AccountData
    accounts: std.AutoHashMap(Pubkey, AccountData),
    /// 捕获的日志输出
    logs: std.ArrayList([]const u8),
    /// 最后一次调用的返回数据
    return_data: ?[]const u8,
    /// 模拟的区块高度
    block_height: u64,
    /// 模拟的时间戳
    timestamp: u64,
    /// 内部分配器
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator) Runtime;
    pub fn deinit(self: *Runtime) void;
};

pub const AccountData = struct {
    lamports: u64,
    data: []u8,
    owner: Pubkey,
    is_signer: bool,
    is_writable: bool,
};
```

### 3.2 账户操作 API

```zig
/// 创建或更新账户
pub fn set_account(self: *Runtime, pubkey: Pubkey, data: AccountData) void;

/// 获取账户（如果存在）
pub fn get_account(self: *Runtime, pubkey: Pubkey) ?AccountData;

/// 设置账户数据（简化接口）
pub fn set_account_data(self: *Runtime, pubkey: Pubkey, data: []const u8) void;

/// 标记账户为 signer
pub fn set_signer(self: *Runtime, pubkey: Pubkey, is_signer: bool) void;
```

### 3.3 输入注入 API

```zig
/// 构建模拟的交易输入
pub fn build_instruction(
    self: *Runtime,
    program_id: Pubkey,
    accounts: []const AccountMeta,
    data: []const u8,
) InstructionInput;

/// 执行合约入口点
pub fn invoke(
    self: *Runtime,
    program: anytype,  // 合约模块
    input: InstructionInput,
) !void;
```

### 3.4 断言与捕获 API

```zig
/// 获取所有日志
pub fn get_logs(self: *Runtime) []const []const u8;

/// 清空日志
pub fn clear_logs(self: *Runtime) void;

/// 获取返回数据
pub fn get_return_data(self: *Runtime) ?[]const u8;

/// 断言日志包含特定字符串
pub fn expect_log_contains(self: *Runtime, expected: []const u8) !void;
```

### 3.5 完整测试示例

```zig
test "counter increment" {
    var runtime = titan.testing.Runtime.init(std.testing.allocator);
    defer runtime.deinit();

    // 1. 设置账户
    const program_id = Pubkey.fromBase58("MyProgram...");
    const state_account = Pubkey.fromBase58("StateAcc...");

    runtime.set_account(state_account, .{
        .lamports = 1_000_000,
        .data = &std.mem.zeroes([64]u8),
        .owner = program_id,
        .is_signer = false,
        .is_writable = true,
    });

    // 2. 构建指令
    const input = runtime.build_instruction(
        program_id,
        &.{ .{ .pubkey = state_account, .is_signer = false, .is_writable = true } },
        &[_]u8{ 0x01 }, // Increment 指令
    );

    // 3. 执行
    try runtime.invoke(@import("my_program"), input);

    // 4. 断言
    const account = runtime.get_account(state_account).?;
    const counter = std.mem.readInt(u64, account.data[0..8], .little);
    try std.testing.expectEqual(@as(u64, 1), counter);
}
```

## 4. 集成测试 (Scenario Testing)

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
