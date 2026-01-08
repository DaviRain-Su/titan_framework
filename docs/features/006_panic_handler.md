# Feature 006: Panic 处理器 (Panic Handler)

> 状态: 待实现
> 所属 Story: [001-内核引导](../../stories/001-kernel-bootstrap.md)

## 1. 背景与目标
在 Zig 中，当代码遇到不可恢复的错误（如断言失败、越界访问）时，会调用 `panic` 函数。默认的 Panic Handler 会尝试打印堆栈并退出，这在区块链上通常行不通（没有 stderr，没有 unwinding）。我们需要覆盖它。

## 2. 行为定义

当发生 Panic 时：
1.  **Release 模式**: 仅打印简短错误信息（或仅退出），最小化 Gas 消耗。
2.  **Debug 模式**: 尝试通过系统调用 (`log`) 打印错误信息、文件名和行号。

## 3. 实现细节 (`src/kernel/panic.zig`)

Zig 允许通过定义一个 `pub fn panic(...)` 函数来覆盖默认行为。

```zig
pub fn panic(msg: []const u8, error_return_trace: ?*std.builtin.StackTrace, ret_addr: ?usize) noreturn {
    // 1. 记录日志
    @import("syscalls.zig").log("TITAN PANIC: ");
    @import("syscalls.zig").log(msg);

    // 2. 终止执行 (返回错误码 1)
    @import("syscalls.zig").exit(1);
}
```

## 4. 依赖关系
*   依赖 **F-004 (系统调用)** 来输出日志和执行退出。

## 5. 测试计划
*   [ ] **触发测试**: 编写一个故意 `unreachable` 或 `assert(false)` 的合约，部署并运行，验证是否在链日志中看到 "TITAN PANIC"。

## 6. 变更日志预览

### Added
- [Kernel] 实现自定义 Panic Handler，支持通过链日志输出 Panic 信息。
