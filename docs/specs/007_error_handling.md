# 规范 007: 错误处理 (Error Handling)

本规范定义了 Titan OS 的异常处理机制。

**设计原则**: 错误是 IO 语义的一部分，必须在资源边界上传播清晰的失败信号。

## 1. 错误模型

Titan OS 采用 Zig 的 **错误集 (Error Set)** 机制，而不是异常 (Exceptions)。

### 1.1 系统级错误 (`titan.Error`)

内核定义了一组标准错误，所有后端必须映射这些错误。

```zig
pub const Error = error {
    OutOfMemory,        // 内存耗尽
    InvalidInput,       // 输入数据无法解析
    Unauthorized,       // 签名或权限缺失
    InstructionFailed,  // 跨合约调用失败
    Timeout,            // 执行超时 (Gas 耗尽)
    CustomError,        // 用户自定义错误 (配合 set_custom_code 使用)
};

// 辅助函数：设置自定义错误码
// 由于 Zig error set 不支持 payload，使用副作用函数传递额外信息
pub fn set_custom_code(code: u32) void;
pub fn get_custom_code() u32;
```

## 2. Panic 处理

Panic (恐慌) 表示不可恢复的代码错误（如数组越界、整数溢出）。

*   **行为**: 立即终止执行，回滚交易。
*   **日志**: 在 Debug 模式下，打印文件名和行号；在 Release 模式下，仅输出简短的错误码以节省 Gas。

### 2.1 自定义 Panic Handler

内核将覆盖 Zig 默认的 Panic Handler：

```zig
pub fn panic(msg: []const u8, trace: ?*std.builtin.StackTrace, ret_addr: ?usize) noreturn {
    // 1. 记录错误信息 (如果 Gas 允许)
    titan.os.log("PANIC: ");
    titan.os.log(msg);
    
    // 2. 退出并返回错误码
    titan.os.exit(1);
}
```

## 3. 错误传播与 Gas 优化

*   推荐使用 `try` 关键字向上传播错误，直到顶层入口点捕获。
*   顶层入口点负责将 Zig 错误转换为链特定的返回码。
    *   **Solana**: 返回 `u64` 类型的 `ProgramError`。
    *   **Wasm**: 调用 `panic` 或返回错误状态。
