# 规范 020: EVM 适配器套件 (EVM Adapter Suite)

> 状态: **已有参考实现** (v0.1.0)
> 核心策略: **双引擎架构 (Dual-Engine Architecture)**。
> 目标: 既能通过转译覆盖所有 EVM 链，又能通过专用后端深入支持高性能 zkEVM。
> 参考实现: [zig-to-yul](https://github.com/DaviRain-Su/zig-to-yul) - **已实现核心功能**

## 已实现功能概览 (zig-to-yul v0.1.0)

`zig-to-yul` 项目已经实现了 Zig -> Yul -> EVM Bytecode 的完整编译流水线。

### 核心能力

| 模块 | 状态 | 说明 |
| :--- | :---: | :--- |
| **编译流水线** | ✅ | Lexer → Parser → Semantic Analysis → CodeGen → Yul |
| **EVM SDK** | ✅ | `evm.types`, `evm.storage`, `evm.event`, `evm.abi` |
| **Gas 估算** | ✅ | 支持 profile overrides |
| **Yul Profiling** | ✅ | 指令计数器聚合 |
| **ABI 生成** | ✅ | JSON ABI + Source Maps |
| **交易签名** | ✅ | Legacy + EIP-1559 + Keystore |
| **跨平台** | ✅ | Linux, macOS, Windows |

### CLI 命令

```bash
# 编译 Zig 到 Yul
z2y compile contract.zig -o contract.yul

# 生成 EVM Bytecode (需要 solc)
z2y build contract.zig -o contract.bin

# Gas 估算
z2y estimate contract.zig

# 性能分析
z2y profile contract.zig
```

### 合约示例 (已实现的语法)

```zig
const evm = @import("evm");

pub const Token = struct {
    total_supply: u256,
    balances: evm.Mapping(evm.Address, u256),

    pub fn transfer(self: *Token, to: evm.Address, amount: u256) bool {
        const sender = evm.caller();
        const sender_balance = self.balances.get(sender);
        if (sender_balance < amount) return false;

        self.balances.set(sender, sender_balance - amount);
        self.balances.set(to, self.balances.get(to) + amount);
        return true;
    }

    pub fn balanceOf(self: *Token, account: evm.Address) u256 {
        return self.balances.get(account);
    }
};
```

### EVM 命名空间 API

| API | 说明 |
| :--- | :--- |
| `evm.caller()` | 获取 msg.sender |
| `evm.callvalue()` | 获取 msg.value |
| `evm.sload(slot)` | 读取存储 |
| `evm.sstore(slot, value)` | 写入存储 |
| `evm.Mapping(K, V)` | 映射类型 |
| `evm.revert()` | 回滚交易 |
| `evm.return_data(data)` | 返回数据 |

## 0. 战略背景：为什么 Yul 是 EVM 的"汇编通道"

### 0.1 架构对称性

如果把 **TON 的 Fift** 看作是通往 TVM 的"汇编通道"，那么 **Yul** 就是通往 EVM 的"汇编通道"。

```
┌─────────────────────────────────────────────────────────────────┐
│                    Titan 万能编译器架构                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  LLVM 编译路径 (Zig 老本行):                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Solana: Zig -> LLVM -> SBF Bytecode      ✓ 原生        │   │
│  │  Wasm:   Zig -> LLVM -> Wasm Bytecode     ✓ 原生        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  SDK 转译路径 (Zig comptime 魔法):                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  TON:    Zig -> SDK Transpiler -> Fift -> TVM Bytecode  │   │
│  │  EVM:    Zig -> SDK Transpiler -> Yul  -> EVM Bytecode  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  核心洞察:                                                       │
│  • 前两个走 LLVM 编译路径                                        │
│  • 后两个走 Zig SDK 转译路径                                     │
│  • 用户层 API 完全一致!                                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 0.2 为什么选 Yul 而不是直接生成 EVM Bytecode？

直接生成 EVM Bytecode (OpCodes) 是非常痛苦的：
- 需要手动管理跳转标签 (JUMPDEST)
- 需要追踪堆栈深度
- 容易出错，难以调试

**Yul 的出现就是为了救命：**

| 特性 | 说明 |
| :--- | :--- |
| **中间语言 (IR)** | 支持变量、循环、函数调用，不用手动写 JUMP |
| **官方支持** | Solidity 编译器 (`solc`) 原生支持，极其优化 |
| **极简主义** | 语法简单，非常适合机器生成 (Machine Generated) |

**结论**: 就像在 TON 上选择生成 Fift 一样，在 EVM 上选择生成 Yul 是**"把脏活累活丢给官方编译器"**的最佳策略。

### 0.3 为什么 "Zig -> Yul" 比 "Zig -> Solidity" 更好？

| 对比点 | Zig -> Solidity | Zig -> Yul |
| :--- | :--- | :--- |
| **类型系统** | 需要凑 Solidity 类型系统 | Yul 几乎无类型 (只有 u256) |
| **控制权** | 受限于 Solidity 语义 | **完全由 Zig SDK 控制** |
| **内存布局** | 强制 Solidity 布局规则 | **可自定义**，优化 Gas |
| **高级特性** | 难以实现 Rust 风格 Enum | 自由定义，编译为位操作 |
| **函数式适配** | Solidity 面向对象，别扭 | Yul 过程式，顺滑 |

**关键洞察**: 类型检查完全由 Zig SDK 在编译时完成，生成到 Yul 时全部变成 `u256` 的位操作。**你拥有了定义语言特性的自由。**

## 1. 策略 A: 通用转译 (Zig -> Yul)

适用于以太坊主网、Optimism、Base、Arbitrum 等标准 EVM 链。

### 1.1 架构映射

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Zig Source  │ ──► │  Zig SDK     │ ──► │  Yul Source  │ ──► │ EVM Bytecode │
│  (用户代码)   │     │  (comptime)  │     │  (.yul)      │     │  (.bin)      │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
                            │                     │
                       我们实现              官方 solc
```

**优势**: 100% EVM 兼容性，无需修改底层编译器。
**劣势**: 无法利用 LLVM 的机器码优化 pass。

### 1.2 映射关系 (The Mapping)

| 用户写的 Zig 代码 | SDK 生成的 Yul 代码 | 解释 |
| :--- | :--- | :--- |
| `a + b` | `add(a, b)` | 基础算术直接映射 |
| `a - b` | `sub(a, b)` | 减法 |
| `a * b` | `mul(a, b)` | 乘法 |
| `a / b` | `div(a, b)` | 除法 |
| `a % b` | `mod(a, b)` | 取模 |
| `a > b` | `gt(a, b)` | 大于比较 |
| `a < b` | `lt(a, b)` | 小于比较 |
| `a == b` | `eq(a, b)` | 等于比较 |
| `ctx.storage.balance = 100` | `sstore(0x01, 100)` | 状态写入 |
| `var x = ctx.storage.balance` | `let x := sload(0x01)` | 状态读取 |
| `if (a > b) { ... }` | `if gt(a, b) { ... }` | 控制流 |
| `while (i < n) { ... }` | `for { } lt(i, n) { } { ... }` | 循环 |

### 1.3 用户视角的代码

```zig
// UserContract.zig
const std = @import("std");
const evm = @import("evm_sdk"); // Titan EVM SDK

// 1. 定义状态 (像 Solidity 的状态变量)
const Data = struct {
    balance: u256,
    owner: evm.Address,
};

// 2. 定义合约逻辑
pub const MyContract = struct {
    usingnamespace evm.Contract(Data);

    // 存款函数
    pub fn deposit(ctx: *Context, amount: u256) !void {
        ctx.data.balance += amount;
    }

    // 提款函数
    pub fn withdraw(ctx: *Context, amount: u256) !void {
        if (ctx.data.balance < amount) return error.InsufficientBalance;
        ctx.data.balance -= amount;
        // 发送 ETH
        try evm.transfer(ctx.caller, amount);
    }

    // Getter
    pub fn getBalance(ctx: *Context) u256 {
        return ctx.data.balance;
    }
};
```

### 1.4 SDK 生成的 Yul 代码

```yul
object "MyContract" {
    code {
        // Constructor
        datacopy(0, dataoffset("runtime"), datasize("runtime"))
        return(0, datasize("runtime"))
    }
    object "runtime" {
        code {
            // Dispatcher (路由)
            switch selector()
            case 0xd0e30db0 /* deposit(uint256) */ {
                deposit(calldataload(4))
            }
            case 0x2e1a7d4d /* withdraw(uint256) */ {
                withdraw(calldataload(4))
            }
            case 0x12065fe0 /* getBalance() */ {
                mstore(0, getBalance())
                return(0, 32)
            }
            default { revert(0, 0) }

            // deposit 函数
            function deposit(amount) {
                let slot_balance := 0
                let old_bal := sload(slot_balance)
                let new_bal := add(old_bal, amount)
                sstore(slot_balance, new_bal)
            }

            // withdraw 函数
            function withdraw(amount) {
                let slot_balance := 0
                let bal := sload(slot_balance)
                if lt(bal, amount) { revert(0, 0) }
                sstore(slot_balance, sub(bal, amount))
                // 转账
                let success := call(gas(), caller(), amount, 0, 0, 0, 0)
                if iszero(success) { revert(0, 0) }
            }

            // getBalance 函数
            function getBalance() -> bal {
                bal := sload(0)
            }

            // Helper: 获取函数选择器
            function selector() -> s {
                s := shr(224, calldataload(0))
            }
        }
    }
}
```

### 1.5 Zig SDK 核心实现 (comptime 魔法)

```zig
// YulBuilder.zig

pub const YulBuilder = struct {
    output: std.ArrayList(u8),

    /// 生成 sstore 指令
    pub fn generateStore(self: *YulBuilder, slot: u256, value: []const u8) !void {
        try self.output.writer().print("sstore({}, {})\n", .{ slot, value });
    }

    /// 生成 sload 指令
    pub fn generateLoad(self: *YulBuilder, slot: u256, dest: []const u8) !void {
        try self.output.writer().print("let {} := sload({})\n", .{ dest, slot });
    }

    /// 生成算术运算
    pub fn generateBinaryOp(self: *YulBuilder, op: BinaryOp, left: []const u8, right: []const u8) ![]const u8 {
        const op_str = switch (op) {
            .add => "add",
            .sub => "sub",
            .mul => "mul",
            .div => "div",
            .mod => "mod",
            .gt => "gt",
            .lt => "lt",
            .eq => "eq",
        };
        return std.fmt.allocPrint(self.allocator, "{}({}, {})", .{ op_str, left, right });
    }
};

/// 核心转译器
pub fn transpileToYul(comptime Contract: type) ![]const u8 {
    comptime {
        var builder = YulBuilder.init();

        // 1. 生成对象头
        builder.emit("object \"Contract\" {\n");
        builder.emit("  code {\n");
        builder.emit("    datacopy(0, dataoffset(\"runtime\"), datasize(\"runtime\"))\n");
        builder.emit("    return(0, datasize(\"runtime\"))\n");
        builder.emit("  }\n");
        builder.emit("  object \"runtime\" {\n");
        builder.emit("    code {\n");

        // 2. 生成 Dispatcher
        builder.emit("      switch selector()\n");
        inline for (std.meta.declarations(Contract)) |decl| {
            if (decl.is_pub and @typeInfo(@TypeOf(@field(Contract, decl.name))) == .Fn) {
                const selector = comptime computeSelector(decl.name);
                builder.emit(std.fmt.comptimePrint(
                    "      case 0x{x} {{ {}(calldataload(4)) }}\n",
                    .{ selector, decl.name },
                ));
            }
        }
        builder.emit("      default { revert(0, 0) }\n");

        // 3. 生成函数体
        inline for (std.meta.declarations(Contract)) |decl| {
            if (decl.is_pub) {
                try generateFunctionYul(&builder, Contract, decl.name);
            }
        }

        builder.emit("    }\n");
        builder.emit("  }\n");
        builder.emit("}\n");

        return builder.toOwnedSlice();
    }
}

/// 计算函数选择器 (Keccak256 前 4 字节)
fn computeSelector(comptime name: []const u8) u32 {
    const hash = std.crypto.hash.sha3.Keccak256.hash(name ++ "(uint256)");
    return @as(u32, hash[0]) << 24 | @as(u32, hash[1]) << 16 |
           @as(u32, hash[2]) << 8 | @as(u32, hash[3]);
}
```

### 1.6 自动存储槽位计算

```zig
/// 自动计算 struct 字段的存储槽位
fn computeStorageLayout(comptime T: type) StorageLayout {
    comptime {
        var layout = StorageLayout{};
        var slot: u256 = 0;

        inline for (std.meta.fields(T)) |field| {
            layout.slots[field.name] = slot;
            // 每个 u256 占用一个槽位
            slot += 1;
        }

        return layout;
    }
}

// 使用示例:
// struct { balance: u256, owner: Address }
// 自动计算: balance -> slot 0, owner -> slot 1
```

## 2. 策略 B: 专用后端 (Zig -> LLVM -> EraVM)

适用于 **zkSync Era** 生态。zkSync 开发了一套基于 LLVM 的编译器后端，专门将 LLVM IR 编译为 EraVM 字节码。

### 2.1 架构映射
*   **Zig** -> **LLVM IR** -> **zkSync Backend** -> **EraVM Bytecode**。
*   **优势**: 极致性能。Zig 的 `ReleaseFast` 优化可以直接传递给 EraVM。
*   **集成方式**:
    1.  Zig 编译器输出 `.ll` 或 `.bc` (LLVM IR 文件)。
    2.  调用 `era-compiler-llvm` 工具处理该 IR。

### 2.2 扩展能力
*   **原生支持**: EraVM 原生支持指针和堆栈操作，比标准 EVM 更接近 LLVM 模型。这意味着 Zig 代码在 zkSync 上跑起来可能比在以太坊主网上更自然、更高效。

## 3. 策略选择 (Selection)

用户在 `build.zig` 中指定：

```bash
# 通用 EVM (生成 Yul)
zig build -Dtarget_chain=evm_generic

# zkSync 专用 (生成 EraVM 汇编)
zig build -Dtarget_chain=zksync
```

## 4. 与 TON 适配器的对称性

Zig -> Yul 和 Zig -> Fift 的实现策略完全对称：

| 目标链 | 中间语言 | 特点 |
| :--- | :--- | :--- |
| **EVM** | Yul | 官方 IR，solc 优化 |
| **TON** | Fift | 官方汇编，TVM 原生 |

**共同点**:
- 都利用 Zig `comptime` 元编程
- 都在编译时完成类型检查
- 都把"脏活累活"丢给官方编译器
- 用户层 API 完全一致

**代码复用**:
- `TypeReflector` - 分析 Zig struct
- `StorageLayout` - 计算存储槽位
- `RouterGenerator` - 生成函数分发
- `CodeEmitter` - 输出目标代码

## 5. 实施状态评估

### 5.1 zig-to-yul 已完成 (v0.1.0)

| 阶段 | 工作内容 | 状态 |
| :--- | :--- | :---: |
| 词法/语法分析 | Lexer, Parser | ✅ 已完成 |
| 语义分析 | 类型检查, 符号表 | ✅ 已完成 |
| 代码生成 | Zig AST → Yul | ✅ 已完成 |
| EVM SDK | types, storage, event, abi | ✅ 已完成 |
| Gas 工具 | 估算, Profiling | ✅ 已完成 |
| 交易签名 | Legacy, EIP-1559, Keystore | ✅ 已完成 |
| 跨平台 | Linux, macOS, Windows | ✅ 已完成 |

### 5.2 Titan 集成路线图

| 阶段 | 工作内容 | 预计工作量 |
| :--- | :--- | :--- |
| **Phase 1** | 将 zig-to-yul 集成到 Titan build system | 1-2 周 |
| **Phase 2** | 统一 API (与 Solana/Near 适配器对齐) | 2-3 周 |
| **Phase 3** | 添加 zkSync EraVM 后端 | 3-4 周 |

**相比 TON 的优势**: EVM 是同步模型，无需 CPS 变换，且 **核心实现已完成**。

## 6. 结论

通过"双引擎"策略，Titan OS 既保持了对 EVM 生态的广泛覆盖，又抓住了 zkEVM 的高性能未来。

### 6.1 核心价值

```
┌─────────────────────────────────────────────────────────────────┐
│                    Titan EVM 适配器价值                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 用户写 Zig，享受:                                            │
│     • 静态类型检查                                               │
│     • LSP 工具支持                                               │
│     • comptime 元编程                                            │
│                                                                 │
│  2. 生成 Yul，获得:                                              │
│     • 100% EVM 兼容                                              │
│     • solc 官方优化                                              │
│     • 可读可调试                                                 │
│                                                                 │
│  3. 一份代码，多链部署:                                          │
│     • Ethereum Mainnet                                          │
│     • Optimism / Base / Arbitrum                                │
│     • zkSync Era (via EraVM)                                    │
│     • 未来任何 EVM 兼容链                                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 战略定位

> **"Zig -> Yul"** 是 Titan 覆盖 EVM 生态最优雅、最科学的路径。
>
> 它与 **"Zig -> Fift"** 形成完美对称，共同构成了 Titan 的**万能编译器架构**。

这是目前市面上**唯一**能打通 Solana + Wasm + TON + EVM 四大生态的架构方案。