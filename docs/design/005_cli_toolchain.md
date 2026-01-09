# 设计 005: CLI 工具链 (Toolchain)

> 状态: 草稿

**设计原则**: CLI 负责暴露资源/IO 抽象的统一开发体验。

## 1. 概述 (Overview)

`titan` CLI 是 Titan OS 的官方命令行工具，用于项目脚手架、构建、测试和部署。它本身也是用 Zig 编写的。

## 2. 核心命令

### 2.1 初始化 (Init)

```bash
# 创建新项目
titan init my-defi-project --template=token

# 目录结构生成
# my-defi-project/
# ├── build.zig
# ├── src/
# │   └── main.zig
# └── titan.toml (项目配置)
```

### 2.2 构建 (Build)

封装 `zig build`，提供更友好的 UX。

```bash
# 自动检测目标链并构建
titan build --chain solana

# 产物优化并输出报告
titan build --release --report
# Output:
# Success! 
# Binary: zig-out/bin/program.so (15KB)
# Compute Units Est: 4500
```

### 2.3 部署 (Deploy)

统一各链的部署流程。

```bash
# 部署到 Solana Devnet
titan deploy --chain solana --net devnet --keypair ~/.config/solana/id.json

# 部署到 Near Testnet
titan deploy --chain near --net testnet --account my-account.testnet
```

## 3. 配置文件 (`titan.toml`)

项目元数据和配置。

```toml
[package]
name = "my-defi-project"
version = "0.1.0"
authors = ["Satoshi"]

[dependencies]
titan_token = "1.0.0"

[profile.solana]
program_id = "8xR..."

[profile.near]
account_id = "contract.near"
```

## 4. 插件系统

CLI 应支持插件扩展，允许社区开发特定的工具（如 IDL 生成器、前端代码生成器）。
