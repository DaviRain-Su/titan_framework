# Feature 002: 多架构入口点 (Multi-Arch Entrypoints)

> 状态: 待实现
> 所属 Story: [001-内核引导](../../stories/001-kernel-bootstrap.md)

**设计原则**: 入口点负责将底层 ABI 转译为统一资源/IO 语义。

## 1. 背景与目标
不同的区块链虚拟机对“程序入口”有不同的约定：
*   **Solana**: 需要导出一个名为 `entrypoint` 的符号，接收序列化参数。
*   **Wasm (Near)**: 导出具体的业务函数（如 `process`），无统一入口。
*   **Wasm (Generic/WASI)**: 导出 `_start`。

Titan OS 需要在 `arch/` 层屏蔽这些差异，向 Kernel 层提供统一的 `main` 调用约定。

## 2. API 设计 (Internal Kernel API)

内核层 (`src/kernel/`) 将假定存在一个由用户定义的 `main` 函数：

```zig
// 用户代码 (src/main.zig)
pub fn main() !void {
    // 用户逻辑
}
```

架构层 (`src/arch/`) 负责调用它。

## 3. 实现细节

### 3.1 目录结构
```text
src/arch/
├── sbf/
│   ├── entrypoint.zig  # Solana 专用入口
│   └── mod.zig         # 导出入口
└── wasm/
    ├── entrypoint.zig  # Wasm 导出函数
    └── mod.zig
```

### 3.2 Solana 实现 (`src/arch/sbf/entrypoint.zig`)

```zig
export fn entrypoint(input: [*]u8) u64 {
    // 1. 初始化全局 Allocator (使用 input 中的堆区域)
    mm.init(input);

    // 2. 调用用户 main
    if (root.main()) |_| {
        return 0; // Success
    } else |err| {
        return 1; // Generic Error
    }
}
```

### 3.3 Wasm 实现 (`src/arch/wasm/entrypoint.zig`)

对于 Near，我们需要一种机制让构建系统知道要导出哪些函数。但在 V1 阶段，我们先实现一个通用的 `_start` 用于测试。

```zig
export fn _start() void {
    _ = root.main() catch return;
}
```

## 4. 依赖关系
*   依赖 **F-001 (构建系统)** 提供的模块注入机制，以便访问 `root` (用户模块)。

## 5. 测试计划
*   [ ] **符号检查**: 使用 `nm` 或 `readelf` 检查 `.so` 文件中是否存在 `entrypoint` 符号。
*   [ ] **Wasm 导出检查**: 使用 `wasm-objdump -x` 检查 Export Section。

## 6. 变更日志预览

### Added
- [Kernel] 实现 SBF 架构的 `entrypoint` 符号导出。
- [Kernel] 实现 Wasm 架构的 `_start` 导出。
