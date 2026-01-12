# 设计 014: Roc Platform 接口规范 (Roc Platform Interface)

> 状态: 规划中 (V2/V3 Target)
> 核心战略: **Roc 业务逻辑 + Zig 底层基座** 双层输入架构
> 目标: 让函数式开发者用 TEA 架构编写跨链合约

## 0. 战略背景：为什么引入 Roc

### 0.1 排除 TypeScript 的战略决策

**关键洞察**: 排除 TypeScript 让项目定位更加**纯粹、硬核且专业**。

| 考虑因素 | TypeScript | Roc |
| :--- | :--- | :--- |
| **性能纯度** | 动态语言坏习惯，隐性性能损耗 | 零运行时，纯函数编译 |
| **目标用户** | 前端开发者 (低门槛) | 金融工程师、协议架构师 (高价值) |
| **工程复杂度** | TS 子集解析器复杂 | Roc/Zig 内存模型亲近 |
| **类型安全** | 可选类型，运行时错误 | 代数数据类型，编译时保证 |

**结论**: 我们做的是**工业级、金融级**的区块链开发基础设施，不是"玩具脚本工具"。

### 0.2 Roc + Zig 双层架构定位

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Titan Framework: 双层输入架构                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                        输入层 (The Input)                              │ │
│  │                                                                       │ │
│  │   ┌─────────────────────────┐     ┌─────────────────────────────────┐│ │
│  │   │   Roc (主要入口)        │     │   Zig (次级入口)                 ││ │
│  │   │   业务逻辑层            │     │   系统层                        ││ │
│  │   │                         │     │                                 ││ │
│  │   │   • TEA 架构            │     │   • Platform 适配器             ││ │
│  │   │   • 状态机逻辑          │     │   • 加密算法库                  ││ │
│  │   │   • 资产流转规则        │     │   • 序列化逻辑                  ││ │
│  │   │   • 业务校验            │     │   • 极致优化模块                ││ │
│  │   │                         │     │                                 ││ │
│  │   │   用户: 协议架构师      │     │   用户: 系统工程师              ││ │
│  │   └─────────────────────────┘     └─────────────────────────────────┘│ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                      │                                      │
│                                      ▼                                      │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                      编译核心 (The Core)                               │ │
│  │                                                                       │ │
│  │   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐  │ │
│  │   │  Roc AST 解析器 │    │  多态生成器     │    │  Zig comptime   │  │ │
│  │   │  (官方 Parser)  │───>│  (Polymorphic   │<───│  SDK            │  │ │
│  │   └─────────────────┘    │   Emitter)      │    └─────────────────┘  │ │
│  │                          └────────┬────────┘                          │ │
│  └───────────────────────────────────┼───────────────────────────────────┘ │
│                                      │                                      │
│               ┌──────────────────────┼──────────────────────┐              │
│               │                      │                      │              │
│               ▼                      ▼                      ▼              │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐│
│  │  路径 A: LLVM       │  │  路径 B: 转译       │  │  路径 C: ZK        ││
│  │  Solana/Wasm/RISC-V │  │  TON/EVM/BTC       │  │  Noir/Circuits     ││
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘│
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 0.3 为什么 Roc 是完美选择

| 特性 | 优势 | 区块链适配性 |
| :--- | :--- | :--- |
| **TEA 架构** | Model-Msg-Update 模式 | 天然映射到 Actor 模型 (TON/ICP) |
| **代数数据类型** | 枚举 + 模式匹配 | 完美映射交易类型和状态机 |
| **纯函数** | 无副作用，可预测 | 交易执行确定性保证 |
| **Perceus 内存管理** | 引用计数，无 GC 暂停 | 链上执行无停顿 |
| **平台抽象** | Platform = 效果处理器 | 天然适配多链后端 |

## 1. TEA 架构与区块链的同构性

### 1.1 TEA (The Elm Architecture) 概述

```
┌─────────────────────────────────────────────────────────────────┐
│                    TEA: Model-Msg-Update                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────┐    Msg     ┌─────────┐    Cmd     ┌─────────┐   │
│   │  View   │ ────────► │ Update  │ ────────► │ Runtime │   │
│   └────┬────┘           └────┬────┘           └────┬────┘   │
│        │                     │                     │         │
│        │     Model           │     Model           │         │
│        ◄─────────────────────┴─────────────────────┘         │
│                                                                 │
│   Model: 不可变状态                                            │
│   Msg:   状态变更请求                                          │
│   Update: 纯函数 (Model, Msg) -> (Model, Cmd)                  │
│   Cmd:   副作用描述 (由 Runtime 执行)                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 TEA 与区块链的数学同构

**核心洞察**: TEA 架构与区块链交易模型是**数学同构**的！

| TEA 概念 | 区块链对应 | 说明 |
| :--- | :--- | :--- |
| `Model` | 合约状态 (State) | 链上存储的数据 |
| `Msg` | 交易 (Transaction) | 用户发起的状态变更请求 |
| `Update` | 合约逻辑 (Execute) | 纯函数处理交易 |
| `Cmd` | 效果 (Effects) | 转账、日志、跨合约调用 |
| `Runtime` | 区块链 VM | 执行 Cmd，持久化 Model |

```
TEA:        (Model, Msg) -> (Model, Cmd)
Blockchain: (State, Tx)  -> (State, Effects)

// 它们是同一个东西！
```

### 1.3 TEA 与 TON Actor 模型的完美映射

**TON 的 Actor 模型**:
- 每个合约是一个 Actor
- Actor 之间通过消息通信
- 消息是异步的，有回调

**TEA 映射**:
```
TON Actor:                    TEA:
┌─────────────────┐          ┌─────────────────┐
│ receive(msg)    │    ≡     │ update(msg)     │
│   -> (state',   │          │   -> (model',   │
│       [msgs])   │          │       [cmds])   │
└─────────────────┘          └─────────────────┘

TON 的 "发送消息给其他 Actor" = TEA 的 "Cmd.SendMsg"
TON 的 "状态更新" = TEA 的 "Model 更新"
```

**这就是为什么 Roc 是 TON 的救世主**: TEA 架构让开发者用优雅的函数式代码处理 TON 复杂的异步回调。

## 2. Roc Platform 接口定义

### 2.1 Platform 概念

在 Roc 中，`Platform` 是处理副作用的运行时。Titan 为每条链实现一个 Platform。

```
┌─────────────────────────────────────────────────────────────────┐
│                    Roc Platform 架构                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Roc App (用户代码)                                            │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  app "my-contract"                                      │  │
│   │      packages { titan: "titan-platform" }               │  │
│   │      imports [ titan.Storage, titan.Token, titan.Msg ]  │  │
│   │      provides [ main ] to titan                         │  │
│   └─────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                              │ provides main                    │
│                              ▼                                  │
│   Titan Platform (Zig 实现)                                     │
│   ┌─────────────────────────────────────────────────────────┐  │
│   │  platform "titan-platform"                              │  │
│   │      requires { main : Model, Msg -> (Model, List Cmd) }│  │
│   │      exposes [ Storage, Token, Msg, Context ]           │  │
│   │      effects [ read, write, transfer, emit, call ]      │  │
│   └─────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                              │ compiles to                      │
│                              ▼                                  │
│   ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐             │
│   │ Solana │  │  Near  │  │  TON   │  │  EVM   │             │
│   │  SBF   │  │  Wasm  │  │  Fift  │  │  Yul   │             │
│   └────────┘  └────────┘  └────────┘  └────────┘             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 核心类型定义

```roc
# titan-platform/Types.roc

## 核心状态类型
Model : [
    # 用户自定义，Platform 不关心内部结构
]

## 消息类型 (交易类型)
Msg : [
    Transfer { from : Address, to : Address, amount : U256 },
    Approve { spender : Address, amount : U256 },
    Custom Str (List U8),
]

## 命令类型 (副作用)
Cmd : [
    None,
    Batch (List Cmd),
    # 存储操作
    StorageWrite { key : Bytes, value : Bytes },
    StorageDelete { key : Bytes },
    # 代币操作
    TransferToken { token : Address, to : Address, amount : U256 },
    # 事件
    EmitEvent { name : Str, data : List U8 },
    # 跨合约调用
    CallContract { target : Address, method : Str, args : List U8, callback : Msg },
    # 异步回调 (TON/Near 特有)
    SendMessage { target : Address, msg : Msg, value : U256 },
]

## 上下文类型
Context : {
    sender : Address,
    value : U256,
    timestamp : U64,
    blockHeight : U64,
    chainId : U32,
}

## 地址类型 (跨链统一)
Address : [
    Solana (List U8),      # 32 bytes
    Evm (List U8),         # 20 bytes
    Near Str,              # account.near
    Ton (List U8),         # 32 bytes
]
```

### 2.3 Platform 接口契约

```roc
# titan-platform/Platform.roc

platform "titan-platform"
    requires {
        ## 用户必须提供的主函数
        ## 这是 TEA 的 update 函数
        main : Context, Model, Msg -> (Model, Cmd)
    }
    exposes [
        ## 类型导出
        Model, Msg, Cmd, Context, Address, U256, Bytes,
        ## 工具函数
        Storage, Token, Math, Crypto,
    ]
    effects [
        ## 副作用处理器 (Zig 实现)
        storageRead : Bytes -> Result Bytes [NotFound],
        storageWrite : Bytes, Bytes -> Result {} [WriteError],
        transfer : Address, U256 -> Result {} [InsufficientBalance, TransferFailed],
        emit : Str, List U8 -> Result {} [],
        call : Address, Str, List U8 -> Result (List U8) [CallFailed],
    ]
```

## 3. 用户代码示例

### 3.1 简单 Token 合约

```roc
# my-token/main.roc

app "my-token"
    packages { titan: "titan-platform" }
    imports [
        titan.{ Model, Msg, Cmd, Context, Address, U256 },
        titan.Storage,
        titan.Math.{ add, sub, gte },
    ]
    provides [main] to titan

## 状态定义
Model : {
    totalSupply : U256,
    balances : Dict Address U256,
    allowances : Dict (Address, Address) U256,
}

## 初始状态
init : Model
init = {
    totalSupply: 1_000_000_000,
    balances: Dict.single owner 1_000_000_000,
    allowances: Dict.empty {},
}

## 消息类型
Msg : [
    Transfer { to : Address, amount : U256 },
    Approve { spender : Address, amount : U256 },
    TransferFrom { from : Address, to : Address, amount : U256 },
    Mint { to : Address, amount : U256 },
    Burn { amount : U256 },
]

## 主函数: TEA 的 update
main : Context, Model, Msg -> (Model, Cmd)
main = \ctx, model, msg ->
    when msg is
        Transfer { to, amount } ->
            transfer ctx.sender to amount model

        Approve { spender, amount } ->
            approve ctx.sender spender amount model

        TransferFrom { from, to, amount } ->
            transferFrom ctx.sender from to amount model

        Mint { to, amount } ->
            mint ctx.sender to amount model

        Burn { amount } ->
            burn ctx.sender amount model

## 转账逻辑 (纯函数)
transfer : Address, Address, U256, Model -> (Model, Cmd)
transfer = \from, to, amount, model ->
    fromBalance = Dict.get model.balances from |> Result.withDefault 0

    if gte fromBalance amount then
        newBalances =
            model.balances
            |> Dict.insert from (sub fromBalance amount)
            |> Dict.update to (\bal -> add (Result.withDefault bal 0) amount)

        newModel = { model & balances: newBalances }
        cmd = Cmd.EmitEvent { name: "Transfer", data: encode { from, to, amount } }
        (newModel, cmd)
    else
        (model, Cmd.None)  # 余额不足，不做任何操作
```

### 3.2 异步 TON 合约 (Actor 模式)

```roc
# ton-vault/main.roc

app "ton-vault"
    packages { titan: "titan-platform" }
    imports [
        titan.{ Model, Msg, Cmd, Context },
        titan.Ton.{ sendMessage, receiveCallback },
    ]
    provides [main] to titan

## 状态: 包含待处理的异步操作
Model : {
    balance : U256,
    pendingWithdrawals : Dict RequestId { user : Address, amount : U256 },
    nextRequestId : U64,
}

## 消息: 包含异步回调
Msg : [
    # 用户操作
    Deposit,
    RequestWithdraw { amount : U256 },

    # 异步回调 (由 TON 运行时触发)
    WithdrawCallback { requestId : U64, success : Bool },
    OracleResponse { requestId : U64, price : U256 },
]

main : Context, Model, Msg -> (Model, Cmd)
main = \ctx, model, msg ->
    when msg is
        Deposit ->
            newModel = { model & balance: add model.balance ctx.value }
            (newModel, Cmd.EmitEvent { name: "Deposited", data: encode ctx.value })

        RequestWithdraw { amount } ->
            if gte model.balance amount then
                requestId = model.nextRequestId
                pending = Dict.insert model.pendingWithdrawals requestId {
                    user: ctx.sender,
                    amount
                }
                newModel = { model &
                    pendingWithdrawals: pending,
                    nextRequestId: requestId + 1,
                    balance: sub model.balance amount,
                }

                # 发送异步消息，设置回调
                cmd = Cmd.SendMessage {
                    target: ctx.sender,
                    msg: Msg.Transfer { amount },
                    value: amount,
                }
                (newModel, cmd)
            else
                (model, Cmd.None)

        WithdrawCallback { requestId, success } ->
            when Dict.get model.pendingWithdrawals requestId is
                Ok { user, amount } ->
                    if success then
                        # 提款成功，清理状态
                        newPending = Dict.remove model.pendingWithdrawals requestId
                        ({ model & pendingWithdrawals: newPending }, Cmd.None)
                    else
                        # 提款失败，退还余额
                        newPending = Dict.remove model.pendingWithdrawals requestId
                        ({ model &
                            pendingWithdrawals: newPending,
                            balance: add model.balance amount,
                        }, Cmd.None)

                Err NotFound ->
                    (model, Cmd.None)

        _ ->
            (model, Cmd.None)
```

## 4. 编译流水线

### 4.1 Roc → Zig → 多链

```
┌─────────────────────────────────────────────────────────────────┐
│                    Roc 编译流水线                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 解析阶段                                                    │
│     ┌──────────┐      ┌──────────┐      ┌──────────────────┐   │
│     │ my-token │      │   Roc    │      │  Typed AST       │   │
│     │   .roc   │ ───► │  Parser  │ ───► │  (Canonical IR)  │   │
│     └──────────┘      └──────────┘      └──────────────────┘   │
│                                                │                │
│  2. 转换阶段                                   │                │
│     ┌──────────────────────────────────────────┘                │
│     │                                                           │
│     ▼                                                           │
│     ┌──────────────────────────────────────────────────────┐   │
│     │              Titan Transformer                        │   │
│     │                                                       │   │
│     │  • 提取 Model/Msg/Cmd 类型定义                       │   │
│     │  • 映射到 Zig struct/enum                            │   │
│     │  • 生成 Platform 桥接代码                             │   │
│     │  • 内联简单函数 (优化)                                │   │
│     └──────────────────────────────────────────────────────┘   │
│                                    │                            │
│  3. 代码生成阶段                   │                            │
│     ┌──────────────────────────────┘                            │
│     │                                                           │
│     ▼                                                           │
│     ┌──────────────────────────────────────────────────────┐   │
│     │                Zig Code Generator                     │   │
│     │                                                       │   │
│     │  生成: my_token.zig                                  │   │
│     │  ├── Model struct                                     │   │
│     │  ├── Msg union                                        │   │
│     │  ├── main function (from Roc)                         │   │
│     │  └── Platform imports                                 │   │
│     └──────────────────────────────────────────────────────┘   │
│                                    │                            │
│  4. 多链编译阶段                   │                            │
│     ┌──────────────────────────────┘                            │
│     │                                                           │
│     │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│     └─►│   Solana    │  │    TON      │  │    EVM      │       │
│        │   (LLVM)    │  │   (Fift)    │  │   (Yul)     │       │
│        └──────┬──────┘  └──────┬──────┘  └──────┬──────┘       │
│               │                │                │               │
│               ▼                ▼                ▼               │
│            .so             .boc             .bin                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 类型映射规则

| Roc 类型 | Zig 类型 | EVM (Yul) | TON (Fift) |
| :--- | :--- | :--- | :--- |
| `U256` | `u256` | `u256` | `int` |
| `U64` | `u64` | `uint64` | `int` |
| `Bool` | `bool` | `bool` | `int` (-1/0) |
| `Str` | `[]const u8` | `bytes` | `slice` |
| `List a` | `[]const a` | ABI encoded | `tuple` |
| `Dict k v` | HashMap | mapping | Dict (cell) |
| `Result ok err` | error union | revert pattern | exception |
| `[Tag1, Tag2]` | `union(enum)` | function selector | op dispatch |

## 5. CLI 命令

```bash
# ===== Roc 项目初始化 =====
titan-roc init my-project              # 创建新 Roc 项目
titan-roc init my-project --template token  # 使用模板

# ===== 编译 =====
titan-roc build                        # 编译到所有配置的链
titan-roc build --target solana        # 只编译 Solana
titan-roc build --target ton           # 只编译 TON

# ===== 测试 =====
titan-roc test                         # 运行 Roc 测试
titan-roc test --coverage              # 带覆盖率

# ===== 部署 =====
titan-roc deploy --target solana --network devnet
titan-roc deploy --target ton --network testnet

# ===== 查看生成代码 =====
titan-roc emit-zig                     # 查看生成的 Zig 代码
titan-roc emit-yul                     # 查看生成的 Yul 代码
titan-roc emit-fift                    # 查看生成的 Fift 代码
```

## 6. 实现路线图

### Phase 1: 基础设施 (Zig 先行)

- [x] Zig SDK 核心类型 (titan.*)
- [x] Solana 后端
- [x] Wasm 后端
- [x] EVM (Yul) 后端
- [ ] TON (Fift) 后端

### Phase 2: Roc 集成

- [ ] Roc AST 解析器集成
- [ ] Model/Msg/Cmd 类型提取
- [ ] Roc → Zig 代码生成器
- [ ] TEA 到 entrypoint 的映射
- [ ] titan-roc CLI 工具

### Phase 3: TEA 运行时

- [ ] 异步 Cmd 调度器 (TON/Near)
- [ ] 回调状态机生成
- [ ] 跨合约消息路由
- [ ] 错误处理和回滚

### Phase 4: 高级特性

- [ ] Roc 类型到 IDL 生成
- [ ] 形式化验证接口
- [ ] 增量编译优化
- [ ] VS Code / LSP 支持

## 7. 与其他设计的关系

| 设计文档 | 关系 | 说明 |
| :--- | :--- | :--- |
| **master_architecture** | 核心依赖 | Roc 作为顶层输入 |
| **006_async_model** | 互补 | TEA Cmd 映射到 Promise |
| **011_adapter_ton** | 实现 | TON Platform 后端 |
| **013_universal_type_system** | 扩展 | Roc 类型需要纳入 |

## 8. 结论

Roc + Zig 双层架构是 Titan Framework 的**终极形态**：

```
┌───────────────────────────────────────────────────────────────────────────┐
│                      Titan Framework 价值主张                              │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  对于业务开发者 (Roc):                                                    │
│  • 用 TEA 架构写合约，像写数学公式一样简单                                │
│  • 编译器保证类型安全，杜绝溢出和逻辑漏洞                                 │
│  • 异步回调自动处理，告别 TON 回调地狱                                   │
│                                                                           │
│  对于系统工程师 (Zig):                                                    │
│  • 极致性能控制，零运行时开销                                            │
│  • comptime 元编程，生成最优代码                                         │
│  • 位级精确控制，处理 Cell/Script 二进制                                 │
│                                                                           │
│  对于项目方:                                                              │
│  • 一套代码，全链部署                                                    │
│  • 工业级安全性，金融级可靠性                                            │
│  • 开发成本降低 75%，审计成本统一                                        │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

**最终目标**: 让 Titan 成为区块链开发的 **"Hardcore, High-Performance, Multi-Chain Compiler"** - 左手握着 Zig 的底层神力，右手握着 Roc 的函数式优雅，脚下踩着 Solana、TON、EVM、Bitcoin 四大生态。
