# Titan OS 技术规范 (Technical Specifications)

本文档汇集了 Titan OS 的所有核心技术规范。这些规范是系统设计和实现的单一真理来源。

## 统一设计原则

所有规范遵循 Linux 的“**一切皆资源/IO**”抽象：链上对象被视为资源，通过统一 IO 语义访问。详见 `docs/architecture/master_architecture.md` 中的资源模型说明。

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
| **008** | [统一代币标准](008_unified_token.md) | 定义跨链通用的 Token 接口 (SPL/ERC20/NEP141)。 |
| **009** | [Solana 适配器](009_adapter_solana.md) | Solana SBF 底层实现细节。 |
| **010** | [Near 适配器](010_adapter_near.md) | Near Wasm 底层实现细节。 |
| **011** | [TON 适配器](011_adapter_ton.md) | TON Tact 转译实现细节。 |
| **012** | [跨链通信协议](012_interchain_messaging.md) | 统一的 LayerZero/IBC 抽象接口。 |
| **013** | [事件与索引](013_events_indexing.md) | 统一的 Log/Event 发送与索引标准。 |
| **014** | [合约升级机制](014_upgradability.md) | 代理升级、原生升级与状态迁移标准。 |
| **015** | [EVM 适配器](015_adapter_evm.md) | 基于 Arbitrum Stylus 的 EVM 互操作规范。 |
| **016** | [Cosmos 适配器](016_adapter_cosmos.md) | CosmWasm Actor 模型与入口点映射规范。 |
| **017** | [运行时引导](017_runtime_bootstrap.md) | 定义如何从底层 entrypoint 引导至用户 main 函数。 |
| **018** | [多链存储适配](018_multichain_storage.md) | Near/Cosmos/Polkadot 的存储层实现细节。 |
| **019** | [Nervos 适配器](019_adapter_ckb.md) | 基于 Cell 模型的 Extended UTXO 适配规范。 |
| **020** | [原生 EVM 适配器](020_adapter_evm_native.md) | Zig 到 Yul 的源码转译规范。 |
| **021** | [Polkadot 适配器](021_adapter_polkadot.md) | Substrate Contracts (ink!) Seal API 与 SCALE 编码规范。 |
| **022** | [后端注册表](022_backend_registry.md) | 所有编译后端的状态、映射与实现路线图。 |

## 高级设计 (Advanced Designs)

| ID | 标题 | 描述 |
| :--- | :--- | :--- |
| **D-001** | [内核结构](design/001_kernel_structure.md) | 定义 Linux 风格的源码树结构。 |
| **D-002** | [驱动模型](design/002_driver_model.md) | 定义如何扩展特定链的功能 (CPI, Promise)。 |
| **D-003** | [安全模型](design/003_security_model.md) | 定义默认安全的内存与权限机制。 |
| **D-004** | [测试框架](design/004_testing_framework.md) | 定义本地 Mock Runtime 和模糊测试策略。 |
| **D-005** | [CLI 工具链](design/005_cli_toolchain.md) | 定义开发者命令行交互流程。 |
| **D-006** | [异步编程模型](design/006_async_model.md) | 定义同步与异步调用的统一抽象 (Promise)。 |
| **D-007** | [IDL 与客户端](design/007_idl_client_gen.md) | 定义接口描述语言及 SDK 生成。 |
| **D-008** | [SDK 映射策略](design/008_sdk_mapping_strategy.md) | 定义多链 SDK 的最大公约数提取策略。 |
| **D-009** | [ZK 隐私架构](design/009_zk_privacy.md) | 定义链上验证与链下电路编译流程。 |
| **D-010** | [形式化验证](../design/010_formal_verification.md) | 定义基于 SMT 求解器的代码安全性证明。 |
| **D-011** | [PDA KV 实现](../design/011_pda_kv_implementation.md) | 详解 Solana 上 Key 到 PDA 账户的映射机制。 |
| **D-012** | [ZK 计算层](../design/012_zk_compute_layer.md) | 链下执行 + 链上验证架构，实现传统互联网应用体验。 |
| **D-013** | [通用类型系统](../design/013_universal_type_system.md) | 链感知类型抽象，实现 Write Once Compile Anywhere。 |
