# 工作单元 001: 内核引导 (Kernel Bootstrap)

> 状态: 进行中
> 优先级: P0 (最高)

## 概述 (Overview)
作为 **Titan OS** 的根基，本 Story 旨在建立一个能够支持多架构（Solana SBF 和 Wasm）的最小化内核环境。完成本 Story 后，我们将拥有一个能编译并在不同链上运行的 "Hello World" 系统。

## 包含特性 (Features Tree)

本 Story 拆解为以下详细特性文档：

### 🏗️ 基础设施
- [ ] **[F-001: 构建系统 V1 (Build System V1)](../docs/features/001_build_system_v1.md)**
    - 目标: 实现 `-Dtarget_chain` 切换逻辑。
    - 输出: 能够生成 `.so` 和 `.wasm` 文件。

### 🔌 内核核心
- [ ] **[F-002: 多架构入口点 (Multi-Arch Entrypoints)](../docs/features/002_kernel_entrypoints.md)**
    - 目标: 实现 Solana 的 `entrypoint` 和 Wasm 的 `_start/export`。
    - 输出: 内核能够被宿主环境加载并执行。
- [ ] **[F-004: 系统调用接口 V1 (Syscall Interface V1)](../docs/features/004_syscall_interface_v1.md)**
    - 目标: 实现 `log`, `exit` 的跨链路由。
    - 输出: 用户可以调用 `titan.os.log()`。
- [ ] **[F-006: Panic 处理器 (Panic Handler)](../docs/features/006_panic_handler.md)**
    - 目标: 捕获运行时错误并输出日志。
    - 输出: 程序崩溃时能打印错误信息。

### 💾 内存管理
- [ ] **[F-003: 基础分配器 V1 (Basic Allocator V1)](../docs/features/003_memory_allocator_v1.md)**
    - 目标: 实现 `TitanAllocator` 接口，映射到底层 VM 内存。
    - 输出: 用户代码可以使用 `allocator.alloc()`。

### 📚 标准库
- [ ] **[F-005: 基础标准库 V1 (Basic Std Lib V1)](../docs/features/005_std_library_v1.md)**
    - 目标: 提供 `titan.collections` 和 `titan.math`。
    - 输出: 用户可以使用 `ArrayList` 和安全数学运算。

## 验收标准 (Acceptance Criteria)
1.  **命令行体验**: 运行 `zig build -Dtarget_chain=solana` 无报错。
2.  **产物验证**: `readelf -h` 显示 Solana 产物为 SBF/BPF 架构，Wasm 产物为 wasm32 架构。
3.  **零依赖**: 生成的内核不依赖 Zig 标准库中不被支持的 OS 部分 (如文件系统)。