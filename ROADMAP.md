# 项目路线图 (ROADMAP)

> Titan Framework 项目状态的单一真理来源 (Source of Truth)。
> **核心定位**: 工业级、金融级跨链开发框架 (Pure Zig + comptime 元编程)

## 核心战略: Pure Zig Metaprogramming

**关键洞察**: Zig 的 `comptime` 能力足够强大，可以直接作为 DSL 使用。

```
用户 Zig 代码 = 运行时逻辑 + 编译时描述
↓
Zig comptime 元编程引擎
↓
┌─────────────┬─────────────┬─────────────┐
│ Solana SBF  │  EVM Yul    │  TON Fift   │
│ (LLVM 直出) │ (转译生成)  │ (转译生成)  │
└─────────────┴─────────────┴─────────────┘
```

详见: [D-015 Pure Zig Metaprogramming](docs/design/015_pure_zig_metaprogramming.md)

## 当前状态: 🏗️ 第一阶段: Pure Zig 基座 (The Foundation)

## 第一阶段: Zig 基座 (The Foundation)

**目标**: 用 Zig 跑通 "Write once, run on Solana & TON"

### 1.1 核心内核 (Kernel)
- [ ] 建立支持交叉编译的构建系统 (`solana`, `wasm`, `mock`)
- [ ] 实现统一内存管理 `TitanAllocator`
- [ ] 实现基础系统调用封装 (`log`, `exit`, `storage_read/write`)
- [ ] 统一入口点 (Entrypoint) 实现

### 1.2 多链后端 (Backends)
- [ ] **Target: Solana (SBF)** - LLVM 路径
- [ ] **Target: Wasm (Near/Cosmos/Polkadot)** - LLVM 路径
- [ ] **Target: TON (TVM)** - Fift 转译路径
- [ ] **Target: EVM (Native)** - Yul 转译路径 (参考: zig-to-yul)

### 1.3 标准库 (Standard Library)
- [ ] `titan.math` (安全数学库, u256 支持)
- [ ] `titan.storage` (统一存储抽象)
- [ ] `titan.crypto` (哈希/签名原语)
- [ ] `titan.Context` (跨链上下文)

### 1.4 里程碑
- **M1.1**: 跨链 Hello World (Solana .so + Wasm .wasm)
- **M1.2**: Solana + Near 双链 Counter 示例
- **M1.3**: EVM (Yul) 后端集成

---

## 第二阶段: Pure Zig 全平台覆盖 (The Expansion)

**目标**: 用 Pure Zig comptime 元编程覆盖所有主流链

### 2.1 核心抽象实现
- [ ] `titan.Storage(T)` comptime 实现 (结构体 → 存储布局)
- [ ] `titan.Context` 跨链上下文统一
- [ ] `titan.Router` 自动入口点生成
- [ ] 类型安全的错误处理

### 2.2 转译后端扩展
- [ ] EVM (Yul) 代码生成器完善
- [ ] TON (Fift/Cell) 代码生成器
- [ ] BTC (Miniscript) 基础支持
- [ ] Stacks (Clarity) 转译器

### 2.3 开发者工具
- [ ] `titan` CLI 统一工具链
- [ ] Pure Zig 项目模板 (Token, Vault, AMM)
- [ ] 多链测试框架 (本地模拟器)

### 2.4 里程碑
- **M2.1**: Pure Zig Token 合约编译到 Solana + EVM
- **M2.2**: Pure Zig 合约部署到 TON
- **M2.3**: 一份 Zig 代码部署到 5+ 链

---

## 第三阶段: 全生态扩张 (The Empire)

**目标**: 适配所有高价值链，建立行业标准地位，可选插件扩展

### 3.1 Bitcoin 生态
- [ ] BTC L2 (EVM) - 复用 Yul 后端
- [ ] BTC L1 (Miniscript) - 转译器
- [ ] Stacks (Clarity) - 转译器
- [ ] BitVM 电路生成 (前沿研究)

### 3.2 ZK/隐私层
- [ ] Noir 转译器 (Zig → Noir)
- [ ] ZK Compute Layer (链下执行 + 链上验证)
- [ ] 隐私应用模板 (ZK Airdrop, 身份验证)

### 3.3 高级特性
- [ ] 形式化验证集成 (SMT 求解器)
- [ ] 跨链通信协议 (Titan IBC)
- [ ] Titan Cloud 托管平台

### 3.4 libtitan: 通用运行时引擎 (核心战略)

> **核弹级升级**: 将 Titan 从"开发框架"升级为"通用区块链运行时引擎"

**核心思想**: 导出 C ABI 接口，让任何能调用 C 的语言都可以使用 Titan 开发合约。

- [ ] C ABI 导出 (`export fn titan_*`)
- [ ] 生成 `titan.h` 头文件
- [ ] 编译为 `libtitan.a` 静态库
- [ ] 验证: C 程序调用 libtitan
- [ ] 验证: Rust FFI 调用 libtitan
- [ ] titan-swift SDK 原型
- [ ] titan-rust SDK (简化版)
- [ ] titan-go (TinyGo) SDK 原型

**战略价值**:
- 万语言支持: Swift/Rust/Go/Nim 开发者可直接使用
- 网络效应: 社区自发创建语言绑定
- 技术护城河: 所有语言最终依赖 Zig 核心

详见: [D-015 Section 8: libtitan](docs/design/015_pure_zig_metaprogramming.md#8-libtitan-通用区块链运行时引擎-universal-runtime)

### 3.5 可选插件: Roc 集成 (非必须)

> **注意**: Roc 作为可选的函数式入口，仅在社区有强烈需求时评估实现

- [ ] Roc AST 解析器集成
- [ ] Roc → Zig 代码生成器
- [ ] TEA 架构支持 (TON Actor 模型)
- [ ] Roc 项目模板

详见: [D-014 Roc Platform Interface](docs/design/014_roc_platform_interface.md) (Future Plugin)

### 3.6 里程碑
- **M3.1**: 支持 10+ 链的编译后端
- **M3.2**: 50+ 活跃项目使用 Titan
- **M3.3**: 行业标准地位确立

---

## 战略优先级 (Strategic Tiers)

| Tier | 目标链/功能 | 优先级 | 说明 |
| :--- | :--- | :---: | :--- |
| **1** | Pure Zig comptime 核心抽象 | P0 | Storage(T), Context, Router |
| **1.5** | Solana, Wasm (Near/Cosmos/Polkadot) | P0 | LLVM 主场，验证核心价值 |
| **2** | EVM Native (Yul), BTC L2 | P0 | EVM 覆盖 + BTC 流动性 |
| **2.5** | **libtitan C ABI** | P1 | 万语言支持，核弹级升级 |
| **3** | ZK (Noir), BTC L1 (Miniscript) | P1 | 隐私 + BTC 原生 |
| **3.5** | TON (Fift), Stacks (Clarity) | P2 | 特殊架构，专门团队 |
| **4** | 语言绑定 (Swift/Rust/Go) | P2 | 社区驱动 |
| **5** | Roc Plugin (可选) | P3 | 函数式入口，非必须 |

---

## 商业里程碑

| 阶段 | 时间线 | 目标 |
| :--- | :--- | :--- |
| **MVP** | Phase 1 | Pure Zig: Solana + EVM 双链验证 |
| **Alpha** | Phase 2 | Pure Zig: 5 链支持 + 核心抽象稳定 |
| **Beta** | Phase 3 | 10+ 链 + 10 家企业客户 + ZK 隐私 |
| **GA** | Phase 3+ | 行业标准 + Titan Cloud + 可选 Roc 插件 |

---

## 历史记录

- **2026-01-12**: **新增 libtitan C ABI 战略** (D-015 Section 8)
  - 核弹级升级: 从"开发框架"升级为"通用区块链运行时引擎"
  - C ABI 导出: `export fn titan_*` 接口
  - 万语言支持: Swift/Rust/Go/Nim 等可直接调用
- **2026-01-12**: **战略转向 Pure Zig 元编程** (D-015)，Roc 降级为可选插件
  - 核心洞察: Zig comptime 足够强大，可直接作为 DSL
  - 三大抽象: Storage(T), Context, Router
  - Roc 从"必须"变为"可选"
- **2026-01-12**: 新增 Sovereign SDK 对比分析 (D-015 Section 7)
  - 混合架构: Linux 骨架 + Sovereign 容器
- **2026-01-12**: 确立 Roc + Zig 双层输入架构 (已被 Pure Zig 策略取代)
- **2026-01-12**: 完成 ZK (Noir) 集成设计 (D-009)
- **2026-01-11**: 完成 Bitcoin 生态适配设计 (023)
- **2026-01-10**: 完成混合编译架构设计
- **2026-01-08**: 项目转型为 **Titan Framework** (纯 Zig 愿景)
