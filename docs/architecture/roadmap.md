# 阶段路线图: Titan OS

本路线图概述了 Titan OS 从多目标构建工具演变为完整区块链操作系统的过程。

## 阶段 1: 内核 (引导阶段)

*   **目标:** 构建能在 Solana 和通用 Wasm 上运行的最小“Titan 内核”。
*   **关键行动:**
    *   **构建系统:** 配置 `build.zig` 以处理交叉编译目标 (`-Dtarget=solana`, `-Dtarget=wasm`)。
    *   **内存分配器:** 实现统一的 `TitanAllocator`，映射到各链底层的内存模型。
    *   **系统调用:** 实现针对 SBF 和 Wasm 的基础 `titan.os.log` 和 `titan.os.return`。
    *   **概念验证:** 一个简单的 Zig 程序，能同时编译为 `.so` 和 `.wasm`，并在本地测试验证器上运行。

## 阶段 2: 标准库 (用户空间)

*   **目标:** 提供 Web3 的“glibc”。
*   **关键行动:**
    *   **Titan 标准库:** 开发 `titan.math` (安全数学)、`titan.collections` (优化的 Map/List) 和 `titan.types` (Address, Pubkey)。
    *   **驱动程序:** 为主要链（Near, Arbitrum Stylus）实现特定的“驱动程序”，将通用系统调用映射为实际的宿主函数。
    *   **测试框架:** 一个能模拟内核层的本地测试运行器，允许开发者在不部署的情况下对合约运行 `zig test`。

## 阶段 3: 生态系统 (工具链)

*   **目标:** 提升开发体验与生产就绪度。
*   **关键行动:**
    *   **Titan CLI:** 用于初始化项目 (`titan init`) 和处理部署 (`titan deploy`) 的工具。
    *   **包管理器:** 集成 Zig 的包管理器 (`build.zig.zon`) 以共享 Titan 库。
    *   **审计标准:** 建立安全 Zig 智能合约开发的编码规范。

## 长期愿景

*   **操作系统级互操作性:** 标准化各链间的“系统调用”，使合约逻辑在数学上保持一致，无论其运行在何处。
*   **RISC-V 支持:** 随着 CKB 等链采用 RISC-V，Titan OS 只需增加新的后端目标即可。
