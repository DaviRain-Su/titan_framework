# 规范 001: 用户 API 设计 (User API)

本规范定义了 Titan OS 应用层开发者面临的编程接口。目标是**零黑魔法、强类型、标准库风格**。

## 1. 核心原则
*   **显式优于隐式**: 内存分配必须显式传入 Allocator。
*   **统一错误处理**: 所有系统错误统一为 `titan.Error` 错误集。
*   **无特定链依赖**: 用户代码中禁止出现 `solana_program` 或 `near_sdk` 等字眼。

## 2. Hello World 示例

```zig
const std = @import("std");
const titan = @import("titan");

/// 程序的入口点。
/// Titan 运行时会自动调用此函数。
pub fn main() !void {
    // 1. 获取系统分配器 (对应链的堆内存或线性内存)
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

存储必须抽象为 Key-Value 结构，即便底层（如 Solana）是 Account 模型。

```zig
// 写入数据
try titan.storage.set("my_key", "my_value");

// 读取数据
// 需要传入 buffer，或者使用 alloc_get 自动分配
var buf: [64]u8 = undefined;
const len = try titan.storage.get("my_key", &buf);
```

## 4. 资产接口 (Token API) - 阶段 2

```zig
// 转账逻辑必须统一
try titan.token.transfer(.{
    .to = recipient_addr,
    .amount = 100,
    .token = titan.token.NATIVE, // SOL or NEAR
});
```

## 5. 待确认需求
*   **入口点参数**: `main` 函数是否应该接受参数？还是像 C 语言一样通过 `std.os.argv` (模拟) 获取？
    *   *建议*: 保持 `main() !void` 无参数，通过 `titan.os.args()` 获取，以保持 Zig 惯用风格。
