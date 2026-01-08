# 技术栈与架构矩阵

Titan OS 的结构类似于传统操作系统，分为 **用户空间 (User Space)** (应用) 和 **内核空间 (Kernel Space)** (Titan Core)，均使用 **Zig** 编写。

## 1. 用户空间: 应用层 (ZIG)

*   **角色:** “用户态”。
*   **开发体验:** 开发者编写标准的 Zig 代码并导入 `titan` 标准库。
*   **特性:**
    *   **统一类型:** `u64`, `u128`, `Address` (抽象后的地址)。
    *   **标准库:** 针对区块链优化的集合库 (`ArrayList`, `HashMap`)、数学库和加密原语。
    *   **无“魔法”:** 显式内存管理，确保可预测的 Gas 成本和性能。

## 2. 内核空间: Titan 内核 (ZIG)

*   **角色:** “HAL” (硬件抽象层)。
*   **功能:** 使用 Zig 的 `comptime` 抽象底层虚拟机的差异。
*   **组件:**
    *   **内存管理器:** 将 `Allocator` 映射到 Solana 的堆内存或 Wasm 的线性内存。
    *   **系统调用接口 (Syscall Interface):** 
        *   `titan.log()` -> `sol_log_compute_units()` (Solana) / `log_utf8` (Near)。
        *   `titan.storage.read()` -> 映射到 `AccountInfo.data` (Solana) / `storage_read` (Near)。
    *   **入口点 (Entrypoint):** 生成各链所需的特定 `entrypoint` 符号（例如 Solana 的 `entrypoint`，Wasm 的导出函数）。

## 3. 编译目标 (硬件层)

我们瞄准区块链世界中两大主流的高性能架构。

### 目标系列 A: SBF (Solana)
*   **架构:** Solana 字节码格式 (eBPF 的变体)。
*   **实现:** Zig LLVM 后端 -> SBF。
*   **状态:** 一等公民。Zig 指针直接映射到 Solana 内存。

### 目标系列 B: WebAssembly (通用架构)
*   **架构:** wasm32-unknown-unknown。
*   **实现:** Zig LLVM 后端 -> Wasm。
*   **子目标 (驱动程序):**
    *   **Near Protocol:** 实现 `near_sdk` 宿主函数。
    *   **Polkadot (Substrate):** 实现 `seal` 宿主函数。
    *   **Cosmos (CosmWasm):** 实现 `cosmwasm` 宿主函数。
    *   **Arbitrum Stylus:** 实现 `stylus` 宿主函数（允许 Zig 运行在以太坊 L2 上）。

### 目标系列 C: 实验性/未来
*   **TON (TVM):**
    *   *挑战:* TVM 并非传统的基于栈/寄存器的架构（而是基于 Cell）。
    *   *策略:* 未来研究。可能采用“Zig -> Tact”转译器或自定义 LLVM 后端，但目前优先级低于 SBF/Wasm。

## 架构图

| 层次 | 组件 | 语言 | 功能 |
| :--- | :--- | :--- | :--- |
| **用户空间** | **dApps / 协议** | **Zig** | 业务逻辑 (DeFi, GameFi, Social) |
| **系统库** | **Titan 标准库** | **Zig** | `titan.math`, `titan.token`, `titan.crypto` |
| **内核层** | **Titan 内核** | **Zig** | 内存分配器, 系统调用封装, 入口点 |
| **硬件层** | **虚拟机** | -- | **Solana VM**, **Wasm VM** (Near/Polkadot/Stylus) |
