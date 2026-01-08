# Feature 004: 系统调用接口 V1 (Syscall Interface V1)

> 状态: 待实现
> 所属 Story: [001-内核引导](../../stories/001-kernel-bootstrap.md)

## 1. 背景与目标
为了实现“一次编写，到处运行”，用户代码不能直接调用 `sol_log` 或 `near_sdk`。我们需要在 `titan.os` 命名空间下提供统一的系统调用接口，并通过 Zig 的 `comptime` 机制在编译时路由到正确的后端实现。

## 2. API 变更 (Public API)

用户将通过 `src/include/titan.zig` 访问以下接口：

```zig
// 打印日志
pub fn log(msg: []const u8) void;

// 退出程序
pub fn exit(code: u32) noreturn;

// 获取时间戳 (暂定 V2，V1 先实现前两个)
// pub fn timestamp() u64;
```

## 3. 实现细节

### 3.1 目录结构
```text
src/kernel/
├── syscalls.zig    # 统一接口定义
└── impl.zig        # 路由逻辑

src/arch/sbf/syscalls.zig  # Solana 实现
src/arch/wasm/syscalls.zig # Wasm 实现
```

### 3.2 路由逻辑 (`src/kernel/impl.zig`)
利用 `build_options.target_chain` 进行分发：

```zig
const options = @import("build_options");

pub const backend = switch (options.target_chain) {
    .solana => @import("../arch/sbf/syscalls.zig"),
    .near, .generic_wasm => @import("../arch/wasm/syscalls.zig"),
    .mock => @import("../arch/mock/syscalls.zig"),
};
```

### 3.3 Solana 后端 (`arch/sbf/syscalls.zig`)
Solana 的系统调用通过 `bpf-tools` 提供的 helper functions。
在 V1 阶段，我们需要手动声明 `extern` 函数，避免引入庞大的 Rust SDK 绑定。

```zig
extern "C" fn sol_log_(message: *const u8, length: u64) void;

pub fn log(msg: []const u8) void {
    sol_log_(msg.ptr, msg.len);
}
```

### 3.4 Wasm 后端 (`arch/wasm/syscalls.zig`)
根据具体链（如 Near）导入宿主函数。

```zig
// Near Protocol 示例
extern "env" fn log_utf8(len: u64, ptr: u64) void;

pub fn log(msg: []const u8) void {
    log_utf8(msg.len, @intFromPtr(msg.ptr));
}
```

## 4. 测试计划
*   [ ] **Mock 测试**: 在 `target_chain=mock` 下，`titan.os.log` 应该打印到标准输出 (`std.debug.print`)。
*   [ ] **Solana 编译测试**: 确保 `extern` 声明不导致链接错误。

## 5. 变更日志预览

### Added
- [Kernel] 定义统一 Syscall 接口 (`log`, `exit`)。
- [Arch/SBF] 实现 `sol_log` 绑定。
- [Arch/Wasm] 实现 `env.log` 绑定。
