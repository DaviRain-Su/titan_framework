# Titan OS - Web3 的 Linux

> **统一的跨链操作系统框架**
> 使用 Zig 构建，为区块链世界提供 Linux 风格的统一抽象层。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Zig v0.15](https://img.shields.io/badge/Zig-0.15.x-orange.svg)](https://ziglang.org)
[![Status: MVP](https://img.shields.io/badge/Status-Under_Development-red.svg)](ROADMAP.md)

---

## 🚀 愿景 (Vision)

Titan OS 旨在解决 Web3 开发的碎片化问题。
正如 Linux 统一了服务器硬件，Titan OS 统一了 **Solana (SBF)**, **Near (Wasm)**, **Cosmos**, **TON** 等高性能区块链。

**Write Once, Deploy Anywhere.**
一套 Zig 代码，编译为原生字节码，零运行时开销。

---

## ✨ 核心特性 (Features)

*   **⚡ 裸机性能**: 不引入虚拟机，直接编译为 SBF 或 Wasm，性能与原生 Rust/C++ 一致。
*   **🧠 统一内存**: `TitanAllocator` 抹平了堆内存 (Solana) 和线性内存 (Wasm) 的差异。
*   **🛡️ 默认安全**: 算术溢出检查、权限系统 (Signer Types)、重入防护内置于框架核心。
*   **🧩 驱动模型**: 核心微内核 + 可插拔驱动，轻松适配各链特有功能 (PDA, Registers)。

---

## 🏁 快速开始 (Quick Start)

### 前置要求
*   Zig 0.15.x (建议使用项目中提供的 `./solana-zig/zig`)
*   Git

### 5 分钟上手
```bash
# 1. 克隆项目
git clone https://github.com/davirain/titan_framework.git
cd titan_framework

# 2. 编译 Hello World (目标: Solana)
./solana-zig/zig build -Dtarget_chain=solana

# 3. 编译 Hello World (目标: Near/Wasm)
./solana-zig/zig build -Dtarget_chain=near

# 产物位于 zig-out/bin/ 目录下
ls -l zig-out/bin/
```

📚 [阅读完整入门指南](docs/guides/getting-started.md)

---

## 📖 文档导航 (Documentation)

### 用户指南 (User Guides)
*   [入门指南 (Getting Started)](docs/guides/getting-started.md)
*   [API 参考 (API Reference)](docs/api/README.md) *(Coming Soon)*

### 核心架构 (Architecture)
*   [系统概览](docs/architecture/system_overview.md) - Titan OS 的设计哲学
*   [技术栈矩阵](docs/architecture/technical_stack.md) - 内核与用户空间的分层
*   [全体系总纲](docs/architecture/master_architecture.md) - V1/V2/V3 演进路线

### 技术规范 (Specifications)
*   [用户 API](docs/specs/001_user_api.md)
*   [内核接口](docs/specs/002_kernel_interface.md)
*   [统一代币标准](docs/specs/008_unified_token.md)
*   [查看所有规范...](docs/specs/README.md)

---

## 🛠️ 贡献 (Contributing)

Titan OS 是一个社区驱动的项目。我们欢迎所有形式的贡献！
请在提交 PR 前阅读 [AGENTS.md](AGENTS.md) 了解我们的编码规范。

## 📜 许可证 (License)

MIT License.
