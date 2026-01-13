# Privacy AMM - Titan Framework

> Solana 首个隐私 AMM，基于 ZK-SNARK 实现完全隐私的代币交换

## 项目状态

**当前阶段**: Phase 1 - 环境搭建与电路开发

## 项目结构

```
privacy-amm/
├── circuits/                      # Circom ZK 电路
│   ├── private_swap.circom        # 主交换电路
│   ├── lib/                       # 共享电路组件
│   │   ├── merkle.circom          # Merkle 树验证
│   │   ├── nullifier.circom       # Nullifier 计算
│   │   └── poseidon.circom        # Poseidon 哈希
│   └── build/                     # 编译输出
│       ├── private_swap.wasm      # Witness 计算器
│       ├── private_swap.zkey      # Proving key
│       └── verification_key.json  # 验证密钥
│
├── solana-program/                # Solana 链上程序 (Zig)
│   └── src/
│       ├── lib.zig                # 程序入口
│       ├── verifier.zig           # Groth16 证明验证
│       ├── merkle.zig             # 链上 Merkle 树
│       ├── pool.zig               # AMM 池状态
│       ├── nullifier_set.zig      # Nullifier 集合
│       └── instructions/          # 指令处理
│           ├── initialize.zig     # 初始化池
│           ├── deposit.zig        # 存款 (公开→隐私)
│           ├── withdraw.zig       # 取款 (隐私→公开)
│           └── swap.zig           # 隐私交换
│
├── cli/                           # Titan CLI 命令 (Zig)
│   └── src/
│       ├── main.zig               # CLI 入口
│       └── commands/
│           ├── swap.zig           # titan swap
│           ├── deposit.zig        # titan deposit
│           ├── withdraw.zig       # titan withdraw
│           └── balance.zig        # titan balance
│
├── relayer/                       # Relayer 服务 (Zig)
│   └── src/
│       └── main.zig               # HTTP 服务器
│
├── tests/                         # 测试
│   ├── circuit_tests/             # 电路测试 (JavaScript)
│   └── integration/               # 集成测试 (Zig)
│
└── sdk/                           # TypeScript SDK (可选)
```

## 核心功能

### 隐私保证

| 隐藏内容 | 说明 |
|:---|:---|
| 交易金额 | 链上无法看到交换了多少代币 |
| 交易方向 | 无法知道是买入还是卖出 |
| 交易者身份 | 通过 Relayer 提交，隐藏发送者 |

### 技术栈

- **ZK 证明**: Groth16 on BN254 (snarkjs)
- **电路语言**: Circom 2.0
- **链上程序**: Zig + solana-program-sdk-zig
- **CLI**: 纯 Zig 实现
- **隐私模型**: UTXO + Nullifier + Merkle Tree

## 快速开始

### 1. 安装依赖

```bash
# 电路开发环境
cd circuits
npm install

# Zig 编译 (需要 Zig 0.15.2+)
zig build
```

### 2. 编译电路

```bash
cd circuits
npm run build
```

### 3. 部署程序

```bash
# 编译 Solana 程序
zig build -Dtarget=sbf

# 部署到 devnet
solana program deploy zig-out/lib/privacy_amm.so
```

### 4. 使用 CLI

```bash
# 存入隐私池
titan deposit --amount 10 --token SOL

# 隐私交换
titan swap --token-in SOL --token-out USDC --amount 5 --min-out 100

# 查看隐私余额
titan balance --all

# 取出到公开地址
titan withdraw --amount 100 --token USDC
```

## 开发进度

### Phase 1: 环境搭建与电路开发 (Day 1-5)
- [x] 创建项目目录结构
- [x] 克隆 privacy-cash-sdk
- [ ] 设置 circuits/package.json
- [ ] 配置 build.zig
- [ ] 实现 private_swap.circom

### Phase 2: Solana 链上程序 (Day 6-10)
- [ ] Groth16 verifier
- [ ] 链上 Merkle 树
- [ ] Nullifier 集合
- [ ] 指令处理

### Phase 3: CLI 开发 (Day 11-14)
- [ ] CLI 框架
- [ ] deposit/withdraw/swap/balance 命令
- [ ] snarkjs 集成
- [ ] UTXO 管理

### Phase 4: Relayer 与集成 (Day 15-18)
- [ ] Relayer HTTP 服务
- [ ] E2E 测试
- [ ] 文档完善

## 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户                                     │
│                          │                                       │
│                          ▼                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Titan CLI                             │   │
│  │  titan deposit / swap / withdraw / balance              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                          │                                       │
│              ┌───────────┴───────────┐                          │
│              ▼                       ▼                          │
│  ┌─────────────────┐     ┌─────────────────┐                   │
│  │  Proof 生成      │     │  Relayer        │                   │
│  │  (snarkjs)       │────▶│  (HTTP)         │                   │
│  └─────────────────┘     └────────┬────────┘                   │
│                                    │                             │
│                                    ▼                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                 Solana (链上)                            │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │              Privacy AMM Program                 │   │   │
│  │  │  • Groth16 Verifier                             │   │   │
│  │  │  • Merkle Tree                                  │   │   │
│  │  │  • Nullifier Set                                │   │   │
│  │  │  • AMM Pool                                     │   │   │
│  │  └─────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## UTXO 模型

```
commitment = poseidon(amount, asset_id, pubkey, blinding)
nullifier  = poseidon(commitment, privateKey, pathIndex)
```

- **commitment**: 隐藏金额和所有者的承诺值
- **nullifier**: 防止双花的作废标记
- **Merkle Tree**: 存储所有 UTXO commitment (深度 20, ~100万 UTXO)

## AMM 约束

电路中强制执行恒定乘积公式:

```
k_after >= k_before
where k = reserve_A * reserve_B
```

## 相关文档

- [详细设计文档](../docs/architecture/zk_amm.md)
- [Titan 白皮书](../docs/architecture/titan_whitepaper.md)
- [solana-program-sdk-zig](https://github.com/anza-xyz/solana-program-sdk-zig)
- [Privacy-Cash SDK](https://github.com/Privacy-Cash/privacy-cash-sdk)

## License

MIT
