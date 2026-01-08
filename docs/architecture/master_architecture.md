# Titan OS 全体系架构总纲 (Master Architecture)

> 状态: **已收敛 (Converged)**
> 优先级说明: 在阶段 1 (V1) 实施过程中，**[规范 000: V1 版收敛设计稿](../specs/000_v1_convergence.md)** 具有最高优先级，所有冲突以此为准。

## 1. 核心设计哲学 (Core Philosophy)

Titan OS 不仅仅是一个 SDK，它是一个**虚拟操作系统**。它在碎片化的区块链虚拟机（VM）之上，构建了一个统一的抽象层。

*   **统一性 (Unity)**: 一套代码，运行在 Solana (SBF), Near (Wasm), TON (TVM), Arbitrum (Stylus) 上。
*   **原生性 (Nativity)**: 不引入虚拟机开销，编译为裸机字节码。
*   **模块化 (Modularity)**: 内核与驱动分离，业务逻辑与底层实现分离。

## 2. 架构分层 (Layered Architecture)

### Layer 0: 硬件抽象层 (HAL / Drivers)
负责抹平底层链的差异。
*   **Memory Driver**: 映射 Heap / Linear Memory / Cell。
*   **Storage Driver**: 映射 Account Data / Trie / Contract Fields。
*   **Async Driver**: 映射 CPI / Promise / Messages。

### Layer 1: 微内核 (Microkernel)
负责提供最基础的系统服务。
*   **Syscalls**: `log`, `exit`, `timestamp`, `random`.
*   **Allocator**: `TitanAllocator` (Bump / FreeList).
*   **Scheduler**: (V2) 简单的协程调度器，用于处理异步回调状态机。

### Layer 2: 系统服务 (System Services)
*   **Security**: `ReentrancyGuard`, `SignerCheck`.
*   **FileSystem (VFS)**: 模拟统一的 KV 存储接口。
*   **Networking**: `IBC`, `LayerZero` 跨链通信抽象。

### Layer 3: 用户空间 (User Space)
*   **StdLib**: `titan.math`, `titan.collections`.
*   **Framework**: `titan.token`, `titan.governance`.
*   **Applications**: 用户编写的 DeFi/GameFi 逻辑。

## 3. 演进路线图 (Evolution Roadmap)

### V1: 内核引导与 Solana 原生 (Kernel Bootstrap)
*   **目标**: 证明 Zig 编写 SBF 合约的可行性与优越性。
*   **能力**:
    *   构建系统支持 `solana` 和 `mock` 目标。
    *   基础内存分配 (Bump Allocator)。
    *   Solana 账户数据的结构化映射。
    *   本地单元测试框架 (Mock Runtime)。

### V2: 异步模型与 Wasm 适配 (Async & Wasm)
*   **目标**: 引入 Near 支持，解决同步 vs 异步的根本矛盾。
*   **能力**:
    *   实现 **TitanPromise** 状态机。
    *   Near 驱动 (Registers & Promises)。
    *   IDL 自动生成 (基于 Struct 反射)。
    *   统一 Token 接口 (适配 NEP-141)。

### V3: 全链互操作与高级特性 (Interoperability & Advanced)
*   **目标**: 连接 TON 与以太坊生态，引入隐私计算，并开放内核能力给其他语言。
*   **能力**:
    *   **TON 适配**: Zig -> Tact 转译器。
    *   **EVM 适配**: 深度集成 **Arbitrum Stylus**，允许 Titan 合约以 Wasm 形式运行在 EVM 链上，并提供 `titan.evm` 模块访问 EVM 特有状态。
    *   **LibTitan (多语言绑定)**: 将 Titan 内核编译为 C-ABI 库 (`libtitan`), 允许 Rust、C++ 甚至 Go 开发者链接 Titan 内核，享受跨链 HAL 的红利。
    *   **ZK 隐私**: 集成 zk-SNARKs 原语 (Groth16/Plonk 验证)。
    *   **Titan IBC**: 基于 intent 的跨链消息协议。
    *   **形式化验证**: 导出逻辑模型供验证工具使用。

## 4. 关键技术决策 (Key Technical Decisions)

1.  **内存模型**: 采用 **Caller-Allocated** 模式作为系统调用标准，兼容 Wasm 的拷贝需求和 Solana 的零拷贝优化。
2.  **异步处理**: 显式状态机 (V1/V2) -> 编译器辅助 CPS 变换 (V3)。
3.  **IDL 生成**: 强制入口参数结构化，利用 Zig 编译时反射生成 JSON 规范。
