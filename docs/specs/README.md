# Titan OS 技术规范 (Technical Specifications)

本文档汇集了 Titan OS 的所有核心技术规范。这些规范是系统设计和实现的单一真理来源。

## 核心规范 (Core Specs)

| ID | 标题 | 描述 |
| :--- | :--- | :--- |
| **001** | [用户 API 设计](001_user_api.md) | 定义用户层开发体验，Hello World 示例。 |
| **002** | [内核接口定义](002_kernel_interface.md) | 定义内核层必须实现的低级原语 (Syscalls)。 |
| **003** | [构建系统设计](003_build_system.md) | 定义 `zig build` 命令行接口和产物输出。 |

## 功能规范 (Feature Specs)

| ID | 标题 | 描述 |
| :--- | :--- | :--- |
| **004** | [内存管理](004_memory_management.md) | 定义堆分配策略、Allocator 接口及内存安全。 |
| **005** | [标准库](005_standard_library.md) | 定义 `titan.lib`，包含数学、集合与加密原语。 |
| **006** | [序列化与 ABI](006_serialization_abi.md) | 定义数据交换格式 (Borsh) 与跨合约调用标准。 |
| **007** | [错误处理](007_error_handling.md) | 定义系统错误集 (`titan.Error`) 与 Panic 机制。 |
