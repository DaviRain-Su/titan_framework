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

## 2.1 Linux 风格资源模型 (Resource/IO Abstraction)

Titan OS 采用 Linux 的核心思想：**一切皆资源 (Resource)**，统一通过 **IO 语义** 访问。

| Linux 概念 | Titan 对应 | 说明 |
| :--- | :--- | :--- |
| File/FD | Resource/Handle | 链上对象被视为可操作资源 |
| Read/Write | `read_input` / `set_output` / `storage_read` / `storage_write` | 统一 IO 接口 |
| IPC | `call` / `invoke` | 跨合约调用视为进程间通信 |
| Log | `log` / `emit_event` | 写入型 IO |
| Process Table | `Context` | 资源表：账户/输入/权限 |
| Driver | `arch/*` / `drivers/*` | 资源后端实现 |

**设计约束**: 新增能力应优先抽象为“资源 + IO 操作”，而非暴露底层链特性。

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

## 4. 混合编译架构 (Hybrid Compilation Architecture)

Titan 的核心创新是**多态编译器 (Polymorphic Compiler)**：根据目标平台特性，智能选择最优编译路径。

### 4.1 上帝视角架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              输入端 (Input)                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  ┌─────────────────────────┐     ┌─────────────────────────────┐   │   │
│  │  │  Roc (主要入口)         │     │  Zig (次级入口)             │   │   │
│  │  │  • 业务逻辑 (TEA)       │     │  • Platform 适配器          │   │   │
│  │  │  • 状态机/资产流转      │     │  • 加密库/序列化            │   │   │
│  │  │  • 用户: 协议架构师     │     │  • 用户: 系统工程师         │   │   │
│  │  └─────────────────────────┘     └─────────────────────────────┘   │   │
│  └───────────────────────────────────┬─────────────────────────────────┘   │
│                                      │                                      │
│                                      ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        处理端 (Titan Core)                           │   │
│  │                                                                       │   │
│  │    ┌───────────────────┐     ┌───────────────────────────────┐      │   │
│  │    │   Unified API     │     │     Zig comptime SDK          │      │   │
│  │    │   titan.*         │     │   (反射 + 代码生成)             │      │   │
│  │    └─────────┬─────────┘     └───────────────┬───────────────┘      │   │
│  │              │                               │                       │   │
│  │              └───────────────┬───────────────┘                       │   │
│  │                              │                                       │   │
│  │                    ┌─────────┴─────────┐                             │   │
│  │                    │  路径选择器        │                             │   │
│  │                    │  (comptime)       │                             │   │
│  │                    └─────────┬─────────┘                             │   │
│  │                              │                                       │   │
│  └──────────────────────────────┼───────────────────────────────────────┘   │
│                                 │                                           │
│               ┌─────────────────┴─────────────────┐                         │
│               │                                   │                         │
│               ▼                                   ▼                         │
│  ┌──────────────────────────┐  ┌──────────────────────────┐  ┌──────────────────────────┐  │
│  │  路径 A: 原生编译        │  │  路径 B: 源对源转译      │  │  路径 C: ZK 电路编译     │  │
│  │  (Native Compilation)    │  │  (Transpilation)         │  │  (ZK Circuit)            │  │
│  │                          │  │                          │  │                          │  │
│  │  Zig -> LLVM -> Target   │  │  Zig -> comptime -> IR   │  │  Zig -> Noir -> ACIR     │  │
│  │                          │  │           -> Target      │  │      -> Verifier         │  │
│  │  ┌────────────────────┐  │  │  ┌────────────────────┐  │  │  ┌────────────────────┐  │  │
│  │  │ Solana (SBF)   ✓   │  │  │  │ TON -> Fift -> TVM│  │  │  │ 隐私空投           │  │  │
│  │  │ Near (Wasm)    ✓   │  │  │  │ EVM -> Yul -> bin │  │  │  │ 身份验证           │  │  │
│  │  │ CosmWasm       ✓   │  │  │  │ BTC -> Miniscript │  │  │  │ 资格证明           │  │  │
│  │  │ Substrate      ✓   │  │  │  │ Stacks -> Clarity │  │  │  │ 可验证计算         │  │  │
│  │  │ Stylus (Wasm)  ✓   │  │  │  │                    │  │  │  └────────────────────┘  │  │
│  │  │ CKB (RISC-V)   ✓   │  │  │  │ 参考: zig-to-yul  │  │  │  输出: .nr + Verifier.sol│  │
│  │  └────────────────────┘  │  │  └────────────────────┘  │  │  详见: D-009, D-012      │  │
│  └──────────────────────────┘  └──────────────────────────┘  └──────────────────────────┘  │
│                                                                             │
│                              输出端 (Output)                                │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  .so (SBF) │ .wasm (Wasm) │ .boc (TVM) │ .bin (EVM) │ .nr/.acir (ZK)│   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 路径 A: 原生编译路径 (LLVM Native)

**适用平台**: Solana (SBF), Near/Cosmos/Polkadot (Wasm), Arbitrum Stylus, CKB (RISC-V)

**原理**: 这些平台基于现代 CPU 架构（寄存器机），与 Zig/LLVM 天然亲和。

```
Zig Source ──► Zig Compiler ──► LLVM IR ──► Target Backend ──► Native Bytecode
                                                │
                    ┌───────────────────────────┼───────────────────────┐
                    │                           │                       │
                    ▼                           ▼                       ▼
               .so (SBF)                  .wasm (Wasm32)          .elf (RISC-V)
```

**优势**:
- **零损耗**: 生成的二进制极其紧凑
- **极致性能**: 直接利用 LLVM 优化 pass
- **原生工具链**: 标准 Zig 编译流程

### 4.3 路径 B: 源对源转译路径 (Transpiler)

**适用平台**: TON (TVM), EVM (Ethereum/L2s)

**原理**: 这些平台架构特殊（栈机、Cell 树），直接生成二进制太难且不可调试。我们生成它们的"官方汇编代码"。

```
Zig Source ──► Zig comptime SDK ──► 中间代码 (IR) ──► 官方编译器 ──► Target Bytecode
                     │                    │                │
                     │              ┌─────┴─────┐          │
                     │              │           │          │
                     ▼              ▼           ▼          ▼
               反射分析         .fif (Fift)  .yul (Yul)   .boc / .bin
               代码生成              │           │
                                     ▼           ▼
                              官方 fift     官方 solc
```

| 目标链 | 中间语言 (IR) | 为什么选它？ | 官方工具 |
| :--- | :--- | :--- | :--- |
| **TON** | Fift | 官方汇编，轻量，避开 Cell 二进制泥潭 | `fift` (C++) |
| **EVM** | Yul | 官方 IR，支持变量/循环，避开手动堆栈管理 | `solc` |

**优势**:
- **把脏活累活丢给官方**: 优化由成熟的官方编译器完成
- **可读可调试**: 生成的中间代码是人类可读的
- **100% 兼容**: 无需修改底层编译器

### 4.4 为什么是"混合"而非"统一"？

| 尝试 | 问题 |
| :--- | :--- |
| 全部走 LLVM | TON (TVM) 没有 LLVM 后端，内存模型不兼容 |
| 全部走转译 | Solana/Wasm 走转译损失性能，多此一举 |
| **混合架构** | **根据平台特性选择最优路径** ✓ |

**关键洞察**: 不搞"一刀切"，而是**因地制宜**。

### 4.5 开发者体验 (DX) 统一

无论底层多复杂，用户看到的是**同一套 API**:

```zig
// 同一份代码，部署到 4 个生态
const titan = @import("titan");

pub const MyContract = struct {
    balance: u256,
    owner: titan.Address,

    pub fn transfer(ctx: *titan.Context, to: titan.Address, amount: u256) !void {
        if (ctx.data.balance < amount) return error.InsufficientBalance;
        ctx.data.balance -= amount;
        try ctx.send(to, amount);  // SDK 自动处理跨链差异
    }
};
```

**编译命令**:
```bash
zig build -Dtarget_chain=solana    # -> .so (SBF)
zig build -Dtarget_chain=near      # -> .wasm
titan-ton compile contract.zig     # -> .boc (via Fift)
titan-evm compile contract.zig     # -> .bin (via Yul)
```

## 5. 关键技术决策 (Key Technical Decisions)

1.  **内存模型**: 采用 **Caller-Allocated** 模式作为系统调用标准，兼容 Wasm 的拷贝需求和 Solana 的零拷贝优化。
2.  **异步处理**: 显式状态机 (V1/V2) -> 编译器辅助 CPS 变换 (V3)。
3.  **IDL 生成**: 强制入口参数结构化，利用 Zig 编译时反射生成 JSON 规范。
4.  **三路编译**: LLVM 原生 (Solana/Wasm) + 转译 (TON/EVM/BTC) + ZK 电路 (Noir)，根据目标平台选择最优路径。
5.  **Zig comptime**: 利用编译时元编程实现 DSL，无运行时开销。
6.  **ZK 隐私**: Zig → Noir 转译，生成 ACIR 电路 + Solidity Verifier，实现链上验证。

## 6. 战略价值 (Strategic Value)

### 6.1 为什么 Titan 是"无敌"的？

```
┌─────────────────────────────────────────────────────────────────┐
│                    Titan OS 核心优势                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 去依赖化 (No Dependency Hell)                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  ✗ 不需要 Node.js (去掉 Tact 依赖)                       │   │
│  │  ✗ 不需要复杂的 Rust 工具链                              │   │
│  │  ✓ 整个工具链可打包成单一二进制文件，下载即用            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  2. 性能与安全的平衡                                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Solana/Wasm: 原生速度 (LLVM 优化)                       │   │
│  │  TON/EVM: 官方编译器优化 (Fift/solc)                     │   │
│  │  = 既省力又安全                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  3. 商业价值最大化                                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  ✓ Solana 的高性能 (DeFi 首选)                           │   │
│  │  ✓ Telegram/TON 的 9 亿用户                              │   │
│  │  ✓ 以太坊 L2 的资金沉淀 (Arbitrum/Optimism)             │   │
│  │  ✓ Cosmos 的互操作性                                     │   │
│  │  = 一个代码库，通吃所有高价值赛道                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 市场定位

> **"Web3 开发范式的大一统理论"**
>
> Titan OS 是区块链世界的 **Vercel**，是连接所有孤岛的那座桥。

| 类比 | Web2 | Web3 (Titan) |
| :--- | :--- | :--- |
| 统一抽象层 | Vercel (屏蔽云厂商差异) | Titan (屏蔽区块链差异) |
| 开发体验 | Next.js (一套代码多平台) | Titan SDK (一套代码多链) |
| 部署平台 | AWS/GCP/Azure | Solana/Near/TON/EVM |

## 7. 行动计划 (Action Plan)

### 7.1 MVP 阶段 (当前)

| 任务 | 状态 | 说明 |
| :--- | :---: | :--- |
| Zig -> Yul 生成器 | ✅ | [zig-to-yul](https://github.com/DaviRain-Su/zig-to-yul) v0.1.0 |
| Solana SBF 后端设计 | ✅ | 规范 009 |
| Near Wasm 后端设计 | ✅ | 规范 010 |
| TON 转译器设计 | ✅ | 规范 011 (含 Fift/comptime DSL) |
| Bitcoin 生态设计 | ✅ | 规范 023 (BTC L1/L2/Stacks) |
| ZK 隐私架构设计 | ✅ | 设计 D-009 (Zig → Noir) |
| ZK 计算层设计 | ✅ | 设计 D-012 (链下执行 + 链上验证) |

### 7.2 集成阶段 (下一步)

| 任务 | 优先级 | 说明 |
| :--- | :---: | :--- |
| Solana Platform 接口实现 | P0 | 内存、IO、账户处理 |
| Near Wasm Platform 实现 | P0 | Registers、Promises |
| 统一 titan.* API | P1 | 抽象层对齐 |
| zig-to-yul 集成到 Titan | P1 | 复用已有实现，覆盖 EVM + BTC L2 |
| BTC L1 Miniscript 转译器 | P1 | 逻辑简单，复用转译架构 |
| ZK: titan.zk SDK 设计 | P2 | Merkle 证明、哈希函数封装 |
| ZK: Zig → Noir 转译器 | P2 | 电路代码生成 |

### 7.3 Roc 集成阶段

| 任务 | 优先级 | 说明 |
| :--- | :---: | :--- |
| Roc AST 解析器集成 | P1 | 利用官方 Parser |
| Roc → Zig 代码生成器 | P1 | TEA 到 entrypoint 映射 |
| titan.roc Platform 接口 | P1 | Model/Msg/Cmd 类型定义 |
| TEA 异步调度器 | P2 | TON/Near 回调状态机 |

### 7.4 高级阶段 (长期)

| 任务 | 优先级 | 说明 |
| :--- | :---: | :--- |
| Stacks Clarity 转译器 | P2 | LISP 语法适配 |
| TON Fift 转译器实现 | P2 | Tier 3，需专门团队 |
| BitVM 电路生成器 | P3 | 前沿研究，等协议稳定 |
| 形式化验证集成 | P3 | SMT 求解器 |

## 8. 结论

**一句话总结**:

> **Titan OS = LLVM 原生 (Solana/Wasm) + 转译 (TON/EVM/BTC) + ZK (Noir)**
>
> **降维打击，全链通吃，隐私可验证。**

这是目前市面上**唯一**能打通以下生态 + 支持 ZK 隐私的架构方案：

| 生态 | 规模 | Titan 支持 | 路径 |
| :--- | :--- | :---: | :--- |
| **Bitcoin** | $1T+ 市值 | ✅ | Miniscript/Yul |
| **Ethereum + L2** | $100B+ TVL | ✅ | Yul |
| **Solana** | 1000万+ 用户 | ✅ | SBF (LLVM) |
| **TON/Telegram** | 9亿用户 | ✅ | Fift |
| **Cosmos** | 50+ 链 | ✅ | Wasm |
| **Polkadot** | 100+ 平行链 | ✅ | Wasm |
| **ZK 隐私** | 所有 EVM 链 | ✅ | Noir → Verifier.sol |

**没有任何一条有价值的链是覆盖不到的。**
**没有任何一个隐私场景是实现不了的。**
