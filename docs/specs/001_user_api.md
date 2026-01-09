# 规范 001: 用户 API 设计 (User API)

本规范定义了 Titan OS 应用层开发者面临的编程接口。目标是提供**零黑魔法、强类型、标准库风格**的开发体验。

**设计原则**: 遵循 Linux “一切皆资源/IO”抽象，尽量将链上对象映射为可读写的资源。

## 1. 核心原则
*   **显式优于隐式**: 所有的内存分配必须显式传入 Allocator（分配器）。
*   **统一错误处理**: 所有系统错误统一归纳为 `titan.Error` 错误集。
*   **无特定链依赖**: 用户代码中禁止出现 `solana_program`、`near_sdk` 或任何特定链的术语。

## 1.1 Context 与 Allocator 的职责边界

*   **Allocator**: 只负责内存分配策略（Bump/Arena/Custom），所有会分配内存的 API 必须显式接收 `allocator`。
*   **Context**: 只承载运行时环境（账户列表、输入数据、程序 ID、主状态账户索引等），不隐式分配内存。

```zig
pub fn main(ctx: *titan.Context, allocator: std.mem.Allocator) !void {
    const input = try titan.os.read_input_copy(allocator);
    defer allocator.free(input);

    var state = ctx.accounts[ctx.state_account_index].load_as(MyState);
    state.counter += 1;
    try ctx.accounts[ctx.state_account_index].save(state);
}
```

## 1.2 用户感知层级 (Account Abstraction)

V1 仍以 Solana 为唯一后端，因此账户模型无法完全隐藏，但 Titan 尽量将其降级为**高级概念**。

*   **默认路径 (推荐)**: 用户仅使用主状态入口，不直接操作账户数组。
*   **高级路径 (可选)**: 需要多账户/CPI 时才显式使用 `ctx.accounts`。

```zig
// Default path: hide accounts
var state = ctx.state().load_as(MyState);
state.counter += 1;
try ctx.state().save(state);

// Advanced path: explicit accounts
const token_account = ctx.accounts[idx];
```

## 2. Hello World 示例

这是最简单的 Titan 应用程序结构：

```zig
const std = @import("std");
const titan = @import("titan");

/// 程序的入口点。
/// Titan 运行时会自动识别并调用此函数。
pub fn main() !void {
    // 1. 获取系统分配器 (自动映射到对应链的堆内存或线性内存)
    const allocator = titan.heap.page_allocator;

    // 2. 打印日志 (自动映射到 sol_log 或 env.log)
    titan.log.info("Hello, Titan OS!", .{});

    // 3. 读取输入 (如交易参数)
    const input_data = try titan.os.read_input(allocator);
    defer allocator.free(input_data);

    // 4. 简单的业务逻辑
    if (input_data.len == 0) {
        titan.log.err("No input provided!", .{});
        return error.InvalidInput;
    }
}
```

## 3. 存储接口 (Storage API)

V1 不提供 KV 风格的 `titan.storage.set/get`。存储仅允许显式结构体映射到账户数据。

```zig
// V1: Explicit Struct-based Mapping
const MyState = struct {
    counter: u64,
};

pub fn update(ctx: *titan.Context) !void {
    var state = ctx.accounts[ctx.state_account_index].load_as(MyState);
    state.counter += 1;
    try ctx.accounts[ctx.state_account_index].save(state);
}
```

## 4. 资产接口 (Token API) - 阶段 2 规划

```zig
// 转账逻辑必须在所有链上统一
try titan.token.transfer(.{
    .to = recipient_addr,
    .amount = 100,
    .token = titan.token.NATIVE, // 代表原生代币 (SOL 或 NEAR)
});
```

## 5. 待确认需求
*   **入口点参数**: `main` 函数是否应该接受参数？
    *   *决策*: 为了保持 Zig 的惯用风格，建议保持 `main() !void` 无参数签名，通过 `titan.os.args()` 或 `titan.os.read_input()` 来获取上下文数据。
