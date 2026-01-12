# 项目路线图 (ROADMAP)

> Titan Framework 项目状态的单一真理来源 (Source of Truth)。
> **核心定位**: 工业级、金融级跨链开发框架 (Roc + Zig)

## 当前状态: 🏗️ 第一阶段: Zig 基座 (The Foundation)

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

## 第二阶段: Roc 接入 (The Abstraction)

**目标**: 引入 Roc 作为业务层 DSL，实现 TEA 架构抽象

### 2.1 Roc 集成基础设施
- [ ] Roc AST 解析器集成 (利用官方 Parser)
- [ ] Roc Model/Msg/Cmd 类型提取
- [ ] Roc → Zig 代码生成器
- [ ] TEA 到 entrypoint 的映射

### 2.2 Roc Platform 实现
- [ ] `titan-platform` Roc Platform 定义
- [ ] Storage/Token/Context 效果处理器
- [ ] 异步 Cmd 调度器 (TON/Near)
- [ ] 回调状态机生成

### 2.3 开发者工具
- [ ] `titan-roc` CLI 工具
- [ ] Roc 项目模板 (Token, Vault, AMM)
- [ ] VS Code / LSP 支持

### 2.4 里程碑
- **M2.1**: Roc Token 合约编译到 Solana
- **M2.2**: Roc TEA 异步合约部署到 TON
- **M2.3**: Roc 一份代码部署到 Solana + TON + EVM

---

## 第三阶段: 全生态扩张 (The Empire)

**目标**: 适配所有高价值链，建立行业标准地位

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

### 3.4 里程碑
- **M3.1**: 支持 10+ 链的编译后端
- **M3.2**: 50+ 活跃项目使用 Titan
- **M3.3**: 行业标准地位确立

---

## 战略优先级 (Strategic Tiers)

| Tier | 目标链/功能 | 优先级 | 说明 |
| :--- | :--- | :---: | :--- |
| **1** | Solana, Wasm (Near/Cosmos/Polkadot) | P0 | LLVM 主场，验证核心价值 |
| **1.5** | BTC L2 (EVM), BTC L1 (Miniscript) | P0 | BTC 流动性最大 |
| **2** | Roc Platform 集成 | P1 | 业务层抽象，TEA 架构 |
| **2.5** | ZK (Noir), EVM Native (Yul) | P1 | 隐私 + EVM 覆盖 |
| **3** | TON (Fift), Stacks (Clarity) | P2 | 特殊架构，专门团队 |

---

## 商业里程碑

| 阶段 | 时间线 | 目标 |
| :--- | :--- | :--- |
| **MVP** | Phase 1 | Solana + Near 双链验证 |
| **Alpha** | Phase 2 | Roc 集成 + 5 链支持 |
| **Beta** | Phase 3 | 10+ 链 + 10 家企业客户 |
| **GA** | Phase 3+ | 行业标准 + Titan Cloud |

---

## 历史记录

- **2026-01-12**: 确立 Roc + Zig 双层输入架构，排除 TypeScript
- **2026-01-12**: 完成 ZK (Noir) 集成设计 (D-009)
- **2026-01-11**: 完成 Bitcoin 生态适配设计 (023)
- **2026-01-10**: 完成混合编译架构设计
- **2026-01-08**: 项目转型为 **Titan Framework** (纯 Zig 愿景)
