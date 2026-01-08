# 规范 002: 内核接口定义 (Kernel Interface)

本规范定义了 **Titan Core (内核)** 必须实现的底层原语。所有用户空间的 API (`titan.*`) 最终都必须调用这些内核函数。这相当于操作系统的“系统调用 (Syscall)”层。

## 1. 架构模式

内核层使用 Zig 的 `comptime` (编译时) 接口模式进行多态分发。

```zig
// src/kernel/mod.zig 伪代码

pub const impl = switch (build_options.target_chain) {
    .solana => @import("solana/mod.zig"),
    .near => @import("near/mod.zig"),
    .mock => @import("mock/mod.zig"), // 用于本地单元测试
};
```

## 2. 必须实现的接口 (The Contract)

任何一个新的后端（如未来支持 Aptos 或 Ton），都必须严格实现以下所有函数签名：

### 2.1 系统基础
```zig
/// 立即终止程序执行，并返回状态码
/// code 0 表示成功，非 0 表示失败
pub fn exit(exit_code: u32) noreturn;

/// 获取当前区块的时间戳 (Unix timestamp)
pub fn timestamp() u64;

/// 获取当前区块高度
pub fn block_height() u64;
```

### 2.2 输入/输出 (I/O)
```zig
/// 打印日志信息到链的控制台
pub fn log(message: []const u8) void;

/// 读取交易输入数据到缓冲区
/// 返回实际读取的字节数
pub fn read_input(buffer: []u8) usize;

/// 设置交易的返回数据 (Return Data)
pub fn set_output(data: []const u8) void;
```

### 2.3 内存管理
```zig
/// 定义堆内存的起始地址 (用于 Allocator 实现)
pub fn heap_start() [*]u8;

/// 定义堆内存的最大可用长度
pub fn heap_len() usize;
```

## 3. SBF (Solana) 具体实现映射
*   `log` -> 映射到 `sol_log_compute_units` 或 `sol_log_data`。
*   `read_input` -> 反序列化入口点参数中的 `input` 指针。
*   `heap_start` -> 映射到 `HEAP_START_ADDRESS` (通常是 0x300000000)。

## 4. Wasm (Generic) 具体实现映射
*   `log` -> 映射到 `env.log` (需按具体链适配，如 Near)。
*   `read_input` -> 映射到 `env.input_read`。
*   `heap_start` -> 映射到 `__heap_base` (链接器自动生成的导出符号)。