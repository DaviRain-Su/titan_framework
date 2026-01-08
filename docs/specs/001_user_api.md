# 规范 001: 用户 API 设计 (User API)

本规范定义了 Titan OS 应用层开发者面临的编程接口。目标是提供**零黑魔法、强类型、标准库风格**的开发体验。

## 1. 核心原则
*   **显式优于隐式**: 所有的内存分配必须显式传入 Allocator（分配器）。
*   **统一错误处理**: 所有系统错误统一归纳为 `titan.Error` 错误集。
*   **无特定链依赖**: 用户代码中禁止出现 `solana_program`、`near_sdk` 或任何特定链的术语。

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

存储操作必须抽象为 Key-Value (键-值) 结构，即便底层（如 Solana）是基于 Account (账户) 模型的。

```zig
// 写入数据
// 将 "my_value" 字符串写入到键 "my_key" 下
try titan.storage.set("my_key", "my_value");

// 读取数据
// 需要传入缓冲区，或者使用 alloc_get 让系统自动分配内存
var buf: [64]u8 = undefined;
const len = try titan.storage.get("my_key", &buf);
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