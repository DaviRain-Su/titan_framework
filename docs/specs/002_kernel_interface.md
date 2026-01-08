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

### 2.0 CoreContext 抽象 (Platform-Agnostic)

`CoreContext` 仅包含跨链通用的最小运行时信息，不绑定任何具体账户模型。

```zig
pub const CoreContext = struct {
    /// Raw input bytes (Borsh by default).
    input: []const u8,
    /// Optional program id (not all chains have this notion).
    program_id: ?Pubkey,
};
```

### 2.0.1 命名约定 (Naming Convention)

*   `titan.Context` 指向 `CoreContext`。
*   各后端通过命名空间暴露扩展上下文（如 `titan.sbf.Context`）。

### 2.1 系统基础
```zig
/// 立即终止程序执行，并返回状态码
/// code 0 表示成功，非 0 表示失败
pub fn exit(exit_code: u32) noreturn;

/// 获取当前区块的时间戳 (Unix timestamp)
pub fn timestamp() u64;

/// 获取当前区块高度
pub fn block_height() u64;

/// 获取一个安全的伪随机数 (由链的宿主环境提供)
pub fn random() u64;
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

## 5. 扩展内核契约 (Extended Contracts)

以下接口为完整实现所需，V1 阶段可部分实现。

### 5.1 存储接口 (Storage)
```zig
/// 从持久化存储读取数据
/// key: 存储键
/// buffer: 用于接收数据的缓冲区
/// 返回: 实际读取的字节数，如果键不存在返回 0
pub fn storage_read(key: []const u8, buffer: []u8) usize;

/// 写入数据到持久化存储
/// key: 存储键
/// value: 要写入的数据
pub fn storage_write(key: []const u8, value: []const u8) void;

/// 检查存储键是否存在
pub fn storage_has(key: []const u8) bool;

/// 删除存储键
pub fn storage_remove(key: []const u8) void;
```

**平台映射**:
*   **Solana**: 直接操作 `AccountInfo.data` 切片（V1 使用 Struct-based Mapping）。
*   **Near**: 映射到 `storage_read/storage_write` 宿主函数。

### 5.2 跨合约调用 (CPI / Cross-Program Invocation)
```zig
/// 调用另一个程序/合约
/// program_id: 目标程序地址
/// instruction_data: 调用数据 (Borsh 序列化)
/// accounts: 账户元数据列表 (Solana 特有，其他链可忽略)
/// 返回: 调用结果数据
pub fn invoke(
    program_id: [32]u8,
    instruction_data: []const u8,
    accounts: []const AccountMeta,
) ![]const u8;

/// 带签名的跨合约调用 (用于 PDA 签名)
pub fn invoke_signed(
    program_id: [32]u8,
    instruction_data: []const u8,
    accounts: []const AccountMeta,
    seeds: []const []const u8,
) ![]const u8;

/// 账户元数据结构
pub const AccountMeta = struct {
    pubkey: [32]u8,
    is_signer: bool,
    is_writable: bool,
};
```

**平台映射**:
*   **Solana**: 映射到 `sol_invoke_signed_c`。
*   **Near**: 映射到 `promise_create` + `promise_then`（异步模型）。

### 5.3 事件/日志 (Events)
```zig
/// 发送结构化事件日志
/// discriminator: 事件类型标识符 (8 字节)
/// data: 事件数据 (Borsh 序列化)
pub fn emit_event(discriminator: [8]u8, data: []const u8) void;
```

**平台映射**:
*   **Solana**: 映射到 `sol_log_data`，格式为 `[discriminator | data]`。
*   **Near**: 映射到 `env.log`，格式遵循 NEP-297 (`EVENT_JSON:{...}`)。

## 6. 接口契约总结

| 类别 | 函数 | V1 必需 | V2 扩展 |
| :--- | :--- | :---: | :---: |
| 系统 | `exit`, `timestamp`, `block_height` | ✓ | |
| I/O | `log`, `read_input`, `set_output` | ✓ | |
| 内存 | `heap_start`, `heap_len` | ✓ | |
| 存储 | `storage_read`, `storage_write` | ✓ | `storage_has`, `storage_remove` |
| CPI | `invoke` | ✓ | `invoke_signed` |
| 事件 | `emit_event` | | ✓ |
| 随机 | `random` | | ✓ |
