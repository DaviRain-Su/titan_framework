# 设计 015: 纯 Zig 元编程架构 (Pure Zig Metaprogramming)

> 状态: **核心设计 (Core Design)**
> 核心战略: **Zig as a Meta-Language** - 用户代码既是运行时代码，也是编译时描述
> 目标: 利用 Zig comptime 实现真正的 "Write Once, Compile Anywhere"

## 0. 战略背景：为什么 Pure Zig 是更优路径

### 0.1 从 Roc + Zig 到 Pure Zig 的战略转向

**关键洞察**: Zig 的 `comptime` 能力使其本身就是一个足够强大的 DSL。不需要引入 Roc 作为额外抽象层。

| 方案 | 复杂度 | 开发者体验 | 工程美感 |
| :--- | :---: | :--- | :--- |
| **Roc + Zig** | 高 | 需学两种语言 | 分层清晰但复杂 |
| **Pure Zig** | 低 | 只学一种语言 | 极致简洁优雅 |

**结论**:
- **先做 Pure Zig 全平台框架**
- Roc 作为未来的"高级语法糖插件"
- Zig 层就是 Roc 的 Runtime

### 0.2 核心思想：Zig as a Meta-Language

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Zig 的双重身份                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  用户写的 Zig 代码:                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  pub const State = struct {                                         │   │
│  │      counter: u64,                                                  │   │
│  │      owner: titan.Address,                                          │   │
│  │  };                                                                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│                    这份代码同时是:                                           │
│                                                                             │
│  ┌─────────────────────────┐     ┌─────────────────────────────────────┐   │
│  │  运行时代码              │     │  编译时描述                         │   │
│  │  (Runtime Code)          │     │  (Compile-time Description)         │   │
│  │                          │     │                                     │   │
│  │  • 实际执行的业务逻辑   │     │  • 被 comptime 反射读取            │   │
│  │  • 状态存储/读取        │     │  • 生成目标链特定代码              │   │
│  │  • 交易处理             │     │  • 自动派生序列化/路由             │   │
│  └─────────────────────────┘     └─────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 0.3 comptime 魔法：代码生成器

框架的核心逻辑：

```
┌─────────────────────────────────────────────────────────────────┐
│  用户 Zig 代码                                                   │
│  (State struct + pub fn)                                        │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Titan SDK (comptime 反射)                                       │
│                                                                 │
│  • 读取 struct 字段类型和布局                                   │
│  • 读取 pub fn 签名                                             │
│  • 根据 -Dtarget 参数选择生成策略                               │
└──────────────────────────┬──────────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ Target:     │  │ Target:     │  │ Target:     │
│ Solana      │  │ EVM         │  │ TON         │
│             │  │             │  │             │
│ 直接编译    │  │ 生成 Yul    │  │ 生成 Cell   │
│ SBF 机器码  │  │ 字符串      │  │ Builder     │
└─────────────┘  └─────────────┘  └─────────────┘
```

## 1. 三大核心抽象 (The Grand Abstraction)

### 1.1 统一存储抽象 (Unified Storage)

**问题**: 不同链的存储模型天差地别

| 链 | 存储模型 | 特点 |
| :--- | :--- | :--- |
| **Solana** | 二进制大对象 (Account Data) | 连续内存，struct 直接映射 |
| **EVM** | 256-bit 键值对 (Slots) | 稀疏存储，需要 slot 计算 |
| **TON** | 树状细胞 (Cell Tree) | 递归结构，自动分片 |
| **Near/Cosmos** | Trie KV | 前缀键，序列化存储 |

**解决方案**: comptime 多态存储

```zig
// titan_sdk/storage.zig

const target = @import("build_options").target_chain;

/// 统一存储 API - 编译时根据目标链选择实现
pub fn Storage(comptime T: type) type {
    return struct {
        /// 保存状态
        pub fn save(state: T) !void {
            if (comptime target == .solana) {
                // Solana: 直接内存映射
                const account_data = getSolanaAccountData();
                @memcpy(account_data, std.mem.asBytes(&state), @sizeOf(T));
            } else if (comptime target == .evm) {
                // EVM: 生成 SSTORE 指令
                comptime var slot: u256 = 0;
                inline for (std.meta.fields(T)) |field| {
                    const value = @field(state, field.name);
                    emitSstore(slot, encodeValue(value));
                    slot += slotSize(field.type);
                }
            } else if (comptime target == .ton) {
                // TON: 构建 Cell Tree
                var builder = CellBuilder.init();
                inline for (std.meta.fields(T)) |field| {
                    const value = @field(state, field.name);
                    builder.store(field.type, value);
                }
                setContractData(builder.finalize());
            } else if (comptime target == .near or target == .cosmwasm) {
                // Near/Cosmos: KV 序列化
                const key = "state";
                const bytes = borsh.serialize(T, state);
                storageWrite(key, bytes);
            }
        }

        /// 加载状态
        pub fn load() !T {
            if (comptime target == .solana) {
                const account_data = getSolanaAccountData();
                return std.mem.bytesToValue(T, account_data[0..@sizeOf(T)]);
            } else if (comptime target == .evm) {
                var state: T = undefined;
                comptime var slot: u256 = 0;
                inline for (std.meta.fields(T)) |field| {
                    const raw = emitSload(slot);
                    @field(state, field.name) = decodeValue(field.type, raw);
                    slot += slotSize(field.type);
                }
                return state;
            } else if (comptime target == .ton) {
                const cell = getContractData();
                var parser = CellParser.init(cell);
                var state: T = undefined;
                inline for (std.meta.fields(T)) |field| {
                    @field(state, field.name) = parser.load(field.type);
                }
                return state;
            } else if (comptime target == .near or target == .cosmwasm) {
                const bytes = storageRead("state") orelse return error.NotFound;
                return borsh.deserialize(T, bytes);
            }
        }
    };
}
```

### 1.2 统一上下文 (Unified Context)

```zig
// titan_sdk/context.zig

const target = @import("build_options").target_chain;

/// 交易上下文 - 屏蔽底层 Syscall 差异
pub const Context = struct {
    /// 调用者地址
    sender: Address,
    /// 附带的原生代币数量
    value: u256,
    /// 当前区块时间戳
    timestamp: u64,
    /// 当前区块高度
    block_height: u64,

    /// 从底层环境初始化上下文
    pub fn init() Context {
        if (comptime target == .solana) {
            return .{
                .sender = Address.fromSolana(getSignerPubkey()),
                .value = 0, // Solana 不支持 native value
                .timestamp = getClockTimestamp(),
                .block_height = getSlot(),
            };
        } else if (comptime target == .evm) {
            return .{
                .sender = Address.fromEvm(evmCaller()),
                .value = evmCallvalue(),
                .timestamp = evmTimestamp(),
                .block_height = evmNumber(),
            };
        } else if (comptime target == .ton) {
            const msg = getCurrentMessage();
            return .{
                .sender = Address.fromTon(msg.sender),
                .value = msg.value,
                .timestamp = getNow(),
                .block_height = 0, // TON 无全局区块高度
            };
        } else if (comptime target == .near) {
            return .{
                .sender = Address.fromNear(predecessorAccountId()),
                .value = attachedDeposit(),
                .timestamp = blockTimestamp(),
                .block_height = blockIndex(),
            };
        }
    }

    /// 统一转账 API
    pub fn transfer(self: *Context, to: Address, amount: u256) !void {
        if (comptime target == .solana) {
            // CPI 调用 System Program
            try invokeCpi(SystemProgram.transfer(self.sender, to, amount));
        } else if (comptime target == .evm) {
            // 生成 CALL 指令
            const success = evmCall(to.toEvm(), amount, "", 0);
            if (!success) return error.TransferFailed;
        } else if (comptime target == .ton) {
            // 构建并发送消息
            var msg = MessageBuilder.init();
            msg.setDestination(to.toTon());
            msg.setValue(amount);
            msg.setMode(SEND_MODE_PAY_GAS_SEPARATELY);
            sendRawMessage(msg.finalize());
        } else if (comptime target == .near) {
            // Promise 转账
            try promiseCreate(to.toNear(), "transfer", amount);
        }
    }

    /// 统一日志/事件 API
    pub fn emit(self: *Context, comptime event_name: []const u8, data: anytype) void {
        if (comptime target == .solana) {
            solLog(event_name ++ ": " ++ formatData(data));
        } else if (comptime target == .evm) {
            // 生成 LOGn 指令
            const topic0 = comptime keccak256(event_name);
            emitLog(topic0, encodeEventData(data));
        } else if (comptime target == .ton) {
            // 发送外部消息作为事件
            emitExternalMessage(event_name, data);
        } else if (comptime target == .near) {
            nearLog(std.fmt.comptimePrint("{s}: {any}", .{ event_name, data }));
        }
    }
};
```

### 1.3 统一入口与路由 (Unified Entry & Router)

**最酷的部分**: 自动遍历用户 struct 的 `pub fn`，生成分发逻辑。

```zig
// titan_sdk/router.zig

const target = @import("build_options").target_chain;

/// 自动生成合约入口点和路由逻辑
pub fn Contract(comptime T: type) type {
    return struct {
        /// 编译时生成的方法列表
        pub const methods = comptime blk: {
            var list: []const MethodInfo = &.{};
            for (std.meta.declarations(T)) |decl| {
                if (decl.is_pub and @typeInfo(@TypeOf(@field(T, decl.name))) == .Fn) {
                    list = list ++ &[_]MethodInfo{.{
                        .name = decl.name,
                        .selector = computeSelector(decl.name),
                    }};
                }
            }
            break :blk list;
        };

        /// 主入口点 - 根据目标链生成不同的分发逻辑
        pub fn dispatch(input: []const u8) !void {
            var ctx = Context.init();

            if (comptime target == .solana) {
                // Solana: 第一个字节是指令 discriminator
                const discriminator = input[0];
                inline for (methods, 0..) |method, i| {
                    if (discriminator == i) {
                        const args = deserializeArgs(method, input[1..]);
                        return @call(.auto, @field(T, method.name), .{&ctx} ++ args);
                    }
                }
                return error.UnknownInstruction;
            } else if (comptime target == .evm) {
                // EVM: 前 4 字节是函数选择器
                const selector = std.mem.readInt(u32, input[0..4], .big);
                inline for (methods) |method| {
                    if (selector == method.selector) {
                        const args = abiDecodeArgs(method, input[4..]);
                        return @call(.auto, @field(T, method.name), .{&ctx} ++ args);
                    }
                }
                return error.UnknownSelector;
            } else if (comptime target == .ton) {
                // TON: op code 在消息体开头
                var parser = CellParser.init(input);
                const op = parser.loadUint(32);
                inline for (methods) |method| {
                    if (op == method.selector) {
                        const args = parser.loadArgs(method);
                        return @call(.auto, @field(T, method.name), .{&ctx} ++ args);
                    }
                }
                return error.UnknownOp;
            }
        }

        /// 计算方法选择器 (EVM 风格)
        fn computeSelector(comptime name: []const u8) u32 {
            const hash = comptime keccak256(name ++ "()"); // 简化，实际需要完整签名
            return std.mem.readInt(u32, hash[0..4], .big);
        }
    };
}
```

## 2. 用户代码示例

### 2.1 完整的 Token 合约

```zig
// contracts/token.zig
const titan = @import("titan_sdk");

/// 状态定义 - 这同时是运行时结构和编译时描述
pub const State = struct {
    name: [32]u8,
    symbol: [8]u8,
    decimals: u8,
    total_supply: u256,
    balances: titan.Map(titan.Address, u256),
    allowances: titan.Map(titan.Address, titan.Map(titan.Address, u256)),
};

/// Token 合约
pub const Token = struct {
    /// 转账
    pub fn transfer(ctx: *titan.Context, to: titan.Address, amount: u256) !void {
        var state = try titan.Storage(State).load();

        const from_balance = state.balances.get(ctx.sender) orelse 0;
        if (from_balance < amount) return error.InsufficientBalance;

        state.balances.put(ctx.sender, from_balance - amount);
        const to_balance = state.balances.get(to) orelse 0;
        state.balances.put(to, to_balance + amount);

        try titan.Storage(State).save(state);
        ctx.emit("Transfer", .{ .from = ctx.sender, .to = to, .amount = amount });
    }

    /// 授权
    pub fn approve(ctx: *titan.Context, spender: titan.Address, amount: u256) !void {
        var state = try titan.Storage(State).load();

        var owner_allowances = state.allowances.get(ctx.sender) orelse titan.Map(titan.Address, u256).init();
        owner_allowances.put(spender, amount);
        state.allowances.put(ctx.sender, owner_allowances);

        try titan.Storage(State).save(state);
        ctx.emit("Approval", .{ .owner = ctx.sender, .spender = spender, .amount = amount });
    }

    /// 授权转账
    pub fn transferFrom(
        ctx: *titan.Context,
        from: titan.Address,
        to: titan.Address,
        amount: u256,
    ) !void {
        var state = try titan.Storage(State).load();

        // 检查授权额度
        var owner_allowances = state.allowances.get(from) orelse return error.NoAllowance;
        const allowed = owner_allowances.get(ctx.sender) orelse 0;
        if (allowed < amount) return error.InsufficientAllowance;

        // 检查余额
        const from_balance = state.balances.get(from) orelse 0;
        if (from_balance < amount) return error.InsufficientBalance;

        // 更新状态
        state.balances.put(from, from_balance - amount);
        const to_balance = state.balances.get(to) orelse 0;
        state.balances.put(to, to_balance + amount);
        owner_allowances.put(ctx.sender, allowed - amount);
        state.allowances.put(from, owner_allowances);

        try titan.Storage(State).save(state);
        ctx.emit("Transfer", .{ .from = from, .to = to, .amount = amount });
    }

    /// 查询余额 (只读)
    pub fn balanceOf(ctx: *titan.Context, account: titan.Address) !u256 {
        const state = try titan.Storage(State).load();
        return state.balances.get(account) orelse 0;
    }
};

// 导出入口点
pub const entrypoint = titan.Contract(Token).dispatch;
```

### 2.2 编译命令

```bash
# 编译到 Solana
zig build -Dtarget_chain=solana
# 输出: zig-out/token.so

# 编译到 EVM (生成 Yul)
zig build -Dtarget_chain=evm
# 输出: zig-out/token.yul
# 然后: solc --strict-assembly token.yul -o token.bin

# 编译到 TON
zig build -Dtarget_chain=ton
# 输出: zig-out/token.fif
# 然后: fift -s token.fif

# 编译到 Near
zig build -Dtarget_chain=near
# 输出: zig-out/token.wasm
```

## 3. 目标链特定策略

### 3.1 EVM: Zig → Yul 字符串生成

EVM 不是二进制兼容的，需要生成 Yul 源码。

```zig
// titan_sdk/backends/evm_codegen.zig

/// 在 comptime 生成 Yul 代码
pub fn generateYul(comptime T: type) []const u8 {
    comptime {
        var code: []const u8 =
            \\object "Contract" {
            \\    code {
            \\        datacopy(0, dataoffset("runtime"), datasize("runtime"))
            \\        return(0, datasize("runtime"))
            \\    }
            \\    object "runtime" {
            \\        code {
            \\            switch selector()
            \\
        ;

        // 为每个方法生成 case
        for (std.meta.declarations(T)) |decl| {
            if (decl.is_pub) {
                const selector = computeSelector(decl.name);
                code = code ++ std.fmt.comptimePrint(
                    \\            case 0x{x:0>8} {{ {s}() }}
                    \\
                , .{ selector, decl.name });
            }
        }

        code = code ++
            \\            default { revert(0, 0) }
            \\
            \\            function selector() -> s {
            \\                s := shr(224, calldataload(0))
            \\            }
            \\
        ;

        // 生成每个函数的 Yul 实现
        for (std.meta.declarations(T)) |decl| {
            if (decl.is_pub) {
                code = code ++ generateFunctionYul(T, decl.name);
            }
        }

        code = code ++
            \\        }
            \\    }
            \\}
        ;

        return code;
    }
}
```

### 3.2 TON: Cell Builder 位打包

利用 Zig 的 `packed struct` 和位操作。

```zig
// titan_sdk/backends/ton_cell.zig

/// TON Cell 构建器
pub const CellBuilder = struct {
    bits: std.ArrayList(u1),
    refs: [4]?*Cell,
    ref_count: u3,

    pub fn init() CellBuilder {
        return .{
            .bits = std.ArrayList(u1).init(allocator),
            .refs = .{ null, null, null, null },
            .ref_count = 0,
        };
    }

    /// 存储无符号整数
    pub fn storeUint(self: *CellBuilder, value: anytype, bits: u10) void {
        var v = value;
        var i: u10 = bits;
        while (i > 0) : (i -= 1) {
            self.bits.append(@truncate((v >> (i - 1)) & 1)) catch unreachable;
        }
    }

    /// 存储地址 (MsgAddress)
    pub fn storeAddress(self: *CellBuilder, addr: titan.Address) void {
        self.storeUint(@as(u2, 0b10), 2); // addr_std$10
        self.storeUint(@as(u1, 0), 1);    // anycast:(Maybe Anycast)
        self.storeUint(@as(i8, 0), 8);    // workchain_id:int8
        self.storeUint(addr.toTonHash(), 256); // address:bits256
    }

    /// comptime 类型自动存储
    pub fn store(self: *CellBuilder, comptime T: type, value: T) void {
        if (comptime T == u64) {
            self.storeUint(value, 64);
        } else if (comptime T == u256) {
            self.storeUint(value, 256);
        } else if (comptime T == titan.Address) {
            self.storeAddress(value);
        } else if (comptime @typeInfo(T) == .Struct) {
            // 递归处理 struct
            inline for (std.meta.fields(T)) |field| {
                self.store(field.type, @field(value, field.name));
            }
        }
    }

    /// 完成并返回 Cell
    pub fn finalize(self: *CellBuilder) *Cell {
        return Cell.fromBuilder(self);
    }
};
```

### 3.3 Solana: 直接编译 + PDA 映射

```zig
// titan_sdk/backends/solana.zig

/// Solana Map 实现 - 基于 PDA
pub fn SolanaMap(comptime K: type, comptime V: type) type {
    return struct {
        const Self = @This();

        /// 计算 PDA 地址
        fn getPDA(key: K) titan.Address {
            const seeds = &[_][]const u8{
                "map",
                std.mem.asBytes(&key),
            };
            const pda = findProgramAddress(seeds, getProgramId());
            return titan.Address.fromSolana(pda);
        }

        /// 获取值
        pub fn get(self: *Self, key: K) ?V {
            const pda = getPDA(key);
            const account = getAccountInfo(pda) orelse return null;
            return std.mem.bytesToValue(V, account.data[0..@sizeOf(V)]);
        }

        /// 设置值
        pub fn put(self: *Self, key: K, value: V) !void {
            const pda = getPDA(key);

            // 如果账户不存在，需要创建
            if (getAccountInfo(pda) == null) {
                try createPDA(pda, @sizeOf(V));
            }

            const account = getAccountInfo(pda).?;
            @memcpy(account.data, std.mem.asBytes(&value), @sizeOf(V));
        }
    };
}
```

## 4. 异步模型处理

### 4.1 TON/Near 异步回调的 Zig 解决方案

**挑战**: TON 和 Near 是异步的，但 Zig 是同步语言。

**解决方案**: 状态机模式 + 编译时回调生成

```zig
// titan_sdk/async.zig

/// 异步操作状态机
pub fn AsyncCall(comptime ResultT: type) type {
    return struct {
        /// 发起异步调用
        pub fn call(
            target: titan.Address,
            method: []const u8,
            args: anytype,
            callback: *const fn (*titan.Context, ResultT) void,
        ) !void {
            if (comptime target == .ton) {
                // TON: 构建消息，设置响应处理器
                var msg = MessageBuilder.init();
                msg.setDestination(target);
                msg.setBody(encodeCall(method, args));
                msg.setBounce(true); // 允许回弹

                // 存储回调状态
                storeCallbackState(msg.queryId(), @ptrToInt(callback));

                sendRawMessage(msg.finalize());
            } else if (comptime target == .near) {
                // Near: Promise chain
                const promise = promiseCreate(target, method, args);
                promiseThen(promise, "handleCallback", .{ @ptrToInt(callback) });
            }
        }

        /// 回调处理器 (由框架自动注册)
        pub fn handleCallback(ctx: *titan.Context, result: []const u8) void {
            const callback_ptr = loadCallbackState(ctx.queryId());
            const callback = @ptrCast(*const fn (*titan.Context, ResultT) void, callback_ptr);
            const decoded = decode(ResultT, result);
            callback(ctx, decoded);
        }
    };
}

// 用户使用方式
pub fn requestPrice(ctx: *titan.Context) !void {
    try titan.AsyncCall(u256).call(
        ORACLE_ADDRESS,
        "getPrice",
        .{ "ETH/USD" },
        onPriceReceived,
    );
}

fn onPriceReceived(ctx: *titan.Context, price: u256) void {
    // 处理价格结果
    var state = titan.Storage(State).load() catch return;
    state.last_price = price;
    titan.Storage(State).save(state) catch return;
}
```

## 5. Pure Zig 方案的优缺点

### 5.1 优点 (Pros)

| 优点 | 说明 |
| :--- | :--- |
| **工程复杂度大幅降低** | 不需要 Roc Parser，整个项目就是纯 Zig |
| **开发者体验统一** | 用户只需学 Zig，C 风格语法更易接受 |
| **调试更方便** | 报错信息清晰直接，都是 Zig 代码 |
| **comptime 是神器** | 处理跨平台代码生成比 Rust 宏更灵活强大 |
| **零运行时开销** | comptime 逻辑在编译时完成，不影响运行时 |

### 5.2 挑战与解决方案

| 挑战 | 解决方案 |
| :--- | :--- |
| **异步模型隐蔽** | SDK 层设计"回调模式"或"状态机模式"，强制用户适配 TON |
| **安全性责任** | SDK 提供封装严密的容器 (SafeMath, SafeMap)，不让用户直接操作指针 |
| **学习曲线** | 提供完善的模板和文档，降低入门门槛 |

## 6. Roc 作为未来插件

当 Pure Zig 框架成熟后，Roc 可以作为"高级语法糖"接入：

```
Roc 代码 (TEA 架构)
        │
        ▼
Roc → Zig 转译器 (未来实现)
        │
        ▼
生成的 Zig 代码 (使用 Titan SDK)
        │
        ▼
Titan SDK (comptime 多态)
        │
        ▼
目标链字节码
```

**关键洞察**: Zig 层就是 Roc 的 Runtime。先做好 Zig，Roc 就是锦上添花。

## 7. 架构参考：Sovereign SDK vs Linux-style

### 7.1 Sovereign SDK 简介

[Sovereign SDK](https://github.com/Sovereign-Labs/sovereign-sdk) 是一个用 Rust 构建的模块化 Rollup 框架，其 `module-system` 设计与 Titan Framework 有**极高的同构性**。

**Sovereign SDK 核心组件**:

| 组件 | 功能 | Titan 对应 |
| :--- | :--- | :--- |
| `sov-modules-api` | 核心 trait 定义 (Spec, Context, Module) | `titan_sdk/` |
| `sov-state` | 状态容器 (StateMap, StateValue) | `titan.Storage(T)` |
| `sov-kernels` | 执行环境 (ZK/Native) | `arch/*` 驱动层 |
| `WorkingSet` | 事务性状态访问 | `titan.Context` |

### 7.2 Sovereign SDK 架构分析

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Sovereign SDK Module System                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  用户模块 (Module):                                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  #[module]                                                           │   │
│  │  struct Bank<S: Spec> {                                              │   │
│  │      #[state]                                                        │   │
│  │      balances: StateMap<S::Address, u64>,                            │   │
│  │  }                                                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│                              ▼                                              │
│  抽象层 (Traits):                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                      │
│  │  Spec        │  │  Context     │  │  Storage     │                      │
│  │  - Address   │  │  - sender()  │  │  - get()     │                      │
│  │  - Hasher    │  │  - time()    │  │  - set()     │                      │
│  │  - Signature │  │  - gas()     │  │  - delete()  │                      │
│  └──────────────┘  └──────────────┘  └──────────────┘                      │
│                              │                                              │
│                              ▼                                              │
│  后端实现:                                                                  │
│  ┌──────────────┐  ┌──────────────┐                                        │
│  │  ZkStorage   │  │  ProverStorage│                                       │
│  │  (ZK 证明)   │  │  (Native 执行)│                                       │
│  └──────────────┘  └──────────────┘                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Sovereign SDK 的优点**:
- Trait 抽象清晰 (Spec, Context, Storage)
- StateMap/StateValue 容器化状态
- 模块间依赖管理 (ModuleVisitor, 拓扑排序)
- ZK 友好的 Witness 系统
- CacheLog 优化状态访问

**Sovereign SDK 的局限**:
- 只针对 ZK-Rollup (同构执行环境)
- 没有处理异构链 (EVM/TON/Solana 差异巨大)
- Rust 泛型嵌套复杂 (`Bank<S: Spec, C: Context<Spec = S>>`)

### 7.3 Linux-style 抽象的优势

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Titan Framework (Linux-style)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  用户空间 (User Space):                                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  const Bank = struct {                                               │   │
│  │      owner: titan.Address,                                           │   │
│  │      balance: u256,                                                  │   │
│  │                                                                      │   │
│  │      pub fn transfer(ctx: *titan.Context, to: Address, amt: u256) {} │   │
│  │  };                                                                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│                              ▼                                              │
│  系统调用层 (Syscalls):                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  storage_*   │  │  log / emit  │  │  call / cpi  │  │  read_input  │   │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘   │
│                              │                                              │
│                              ▼                                              │
│  驱动层 (Drivers / arch/*):                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  solana/     │  │  evm/        │  │  ton/        │  │  wasm/       │   │
│  │  - AccountInfo│  │  - SLOAD    │  │  - Cell      │  │  - host_*    │   │
│  │  - CPI       │  │  - CALL     │  │  - SENDRAWMSG│  │  - Promise   │   │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Linux-style 的优点**:
- 支持异构链 (EVM/TON/Solana 差异通过驱动层隔离)
- comptime 在编译时选择后端，零运行时开销
- 概念熟悉 (Linux syscall 模型)
- 更底层控制 (可以绕过抽象直接调用驱动)

**Linux-style 的局限**:
- 需要更多手动实现
- 模块间依赖管理需要自己设计

### 7.4 融合方案：Linux 骨架 + Sovereign 容器

**核心决策**: 以 Linux-style 为骨架，融入 Sovereign SDK 的精华。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│              Titan Framework: 融合架构 (Hybrid Architecture)                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Layer 3: 用户模块 (借鉴 Sovereign: StateMap/StateValue 容器)               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  const Bank = struct {                                               │   │
│  │      balances: titan.StateMap(Address, u256),  // ← Sovereign 风格   │   │
│  │      total_supply: titan.StateValue(u256),     // ← Sovereign 风格   │   │
│  │                                                                      │   │
│  │      pub fn transfer(ctx: *titan.Context, to: Address, amt: u256) {} │   │
│  │  };                                                                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│  Layer 2: 系统服务 (Linux-style Syscalls + Sovereign Context)               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  titan.Context:                                                      │   │
│  │    - sender() → Address        (Sovereign 风格)                      │   │
│  │    - value()  → u256           (Sovereign 风格)                      │   │
│  │    - emit(event)               (Linux syscall 风格)                  │   │
│  │    - call(target, data)        (Linux syscall 风格)                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│  Layer 1: 内核 (Linux-style: comptime 驱动选择)                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  if (comptime target == .solana) {                                   │   │
│  │      // Solana: PDA + AccountInfo                                    │   │
│  │  } else if (comptime target == .evm) {                               │   │
│  │      // EVM: SLOAD/SSTORE + keccak256 slot                           │   │
│  │  } else if (comptime target == .ton) {                               │   │
│  │      // TON: Cell Builder + SENDRAWMSG                               │   │
│  │  }                                                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│  Layer 0: 驱动 (Linux-style: arch/* 目录结构)                               │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐           │
│  │ arch/solana│  │ arch/evm   │  │ arch/ton   │  │ arch/wasm  │           │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.5 从 Sovereign SDK 借鉴什么

| 组件 | 从 Sovereign 借鉴 | 用 Zig/Linux 改进 |
| :--- | :--- | :--- |
| **StateMap/StateValue** | ✅ 容器化思想 | comptime 选择后端，而非 Rust trait |
| **Context** | ✅ sender/value/time 统一 | comptime 条件编译添加链特有字段 |
| **Module 依赖** | ✅ 拓扑排序思想 | comptime 静态检查，无运行时开销 |
| **Witness** | ✅ ZK 证明系统 | 只在 `-Dtarget=zk` 时启用 |
| **CacheLog** | ✅ 状态访问优化 | comptime 内联优化 |
| **Storage Trait** | ❌ Rust trait 太复杂 | Linux syscall 风格: `storage_read/write` |
| **Async 模型** | ❌ Sovereign 无此需求 | 新增 `titan.Message` 处理 TON/Near 异步 |

### 7.6 Sovereign SDK 没有但 Titan 需要的

#### 7.6.1 异步模型抽象 (The Async Gap)

Sovereign 的 `call` 函数通常是同步返回结果的。这在 TON 上行不通。

```zig
// Titan SDK 需要支持消息传递模式
pub fn call_other_contract(ctx: *Context, target: Address, msg: anytype) !void {
    if (comptime target_chain == .ton) {
        // TON: 生成 SENDRAWMSG，结束当前执行，等待回调
        ctx.send_message(target, msg);
    } else if (comptime target_chain == .near) {
        // Near: Promise 链
        try ctx.promise_create(target, msg);
    } else {
        // EVM/Solana: 直接执行同步调用
        const res = ctx.sync_call(target, msg);
    }
}
```

#### 7.6.2 资产模型抽象 (Asset Model)

Sovereign SDK 里的资产通常只是状态树上的一个数字。但在 Solana 上，资产是独立的 Account。

```zig
// Titan 定义统一的 Token 抽象类型
pub const Token = struct {
    pub fn transfer(ctx: *Context, to: Address, amount: u256) !void {
        if (comptime target_chain == .solana) {
            // CPI 调用 SPL Token Program
            try spl_token.transfer(ctx, to, amount);
        } else if (comptime target_chain == .evm) {
            // 内部余额更新 (ERC20 模式)
            try update_balance(ctx.sender, to, amount);
        } else if (comptime target_chain == .ton) {
            // Jetton 消息发送
            try jetton.send_transfer(ctx, to, amount);
        }
    }
};
```

### 7.7 最终目录结构

基于融合架构的推荐目录结构:

```
titan/
├── kernel/                      # Linux 内核层
│   ├── syscalls.zig             # storage_*, log, call, ...
│   ├── allocator.zig            # TitanAllocator
│   └── context.zig              # Context 实现
│
├── arch/                        # Linux 驱动层 (per-chain)
│   ├── solana/
│   │   ├── account.zig
│   │   ├── cpi.zig
│   │   └── pda.zig
│   ├── evm/
│   │   ├── storage.zig          # SLOAD/SSTORE
│   │   ├── call.zig
│   │   └── yul_codegen.zig
│   ├── ton/
│   │   ├── cell.zig
│   │   ├── message.zig
│   │   └── fift_codegen.zig
│   └── wasm/
│       ├── host.zig
│       └── promise.zig
│
├── lib/                         # Sovereign 风格容器
│   ├── state_map.zig            # StateMap(K, V) - 借鉴 Sovereign
│   ├── state_value.zig          # StateValue(T) - 借鉴 Sovereign
│   ├── address.zig              # 跨链统一地址
│   └── math.zig                 # u256 安全数学
│
├── std/                         # 标准库 (高级抽象)
│   ├── token.zig                # ERC20/SPL/Jetton 统一
│   ├── nft.zig
│   └── governance.zig
│
└── router.zig                   # 入口点生成器
```

### 7.8 StateMap/StateValue 实现示例

借鉴 Sovereign SDK 的容器化思想，用 Zig comptime 实现:

```zig
// titan/lib/state_map.zig

const target = @import("build_options").target_chain;

/// StateMap - 借鉴 Sovereign SDK 的状态容器设计
/// 键值对存储，自动处理跨链存储差异
pub fn StateMap(comptime K: type, comptime V: type) type {
    return struct {
        const Self = @This();

        // 内部状态 (根据目标链不同)
        inner: if (target == .solana) SolanaPdaMap(K, V)
               else if (target == .evm) EvmSlotMap(K, V)
               else if (target == .ton) TonCellMap(K, V)
               else WasmKvMap(K, V),

        /// 获取值
        pub fn get(self: *Self, key: K) ?V {
            return self.inner.get(key);
        }

        /// 设置值
        pub fn set(self: *Self, key: K, value: V) !void {
            return self.inner.set(key, value);
        }

        /// 删除值
        pub fn remove(self: *Self, key: K) !void {
            return self.inner.remove(key);
        }

        /// 检查是否存在
        pub fn contains(self: *Self, key: K) bool {
            return self.inner.contains(key);
        }
    };
}

/// StateValue - 单值存储
/// 借鉴 Sovereign SDK: "group data that is frequently read together"
pub fn StateValue(comptime T: type) type {
    return struct {
        const Self = @This();

        /// 获取值
        pub fn get(self: *Self) !T {
            if (comptime target == .solana) {
                return self.loadFromAccount();
            } else if (comptime target == .evm) {
                return self.loadFromSlots();
            } else if (comptime target == .ton) {
                return self.loadFromCell();
            } else {
                return self.loadFromKv();
            }
        }

        /// 设置值
        pub fn set(self: *Self, value: T) !void {
            if (comptime target == .solana) {
                try self.saveToAccount(value);
            } else if (comptime target == .evm) {
                try self.saveToSlots(value);
            } else if (comptime target == .ton) {
                try self.saveToCell(value);
            } else {
                try self.saveToKv(value);
            }
        }
    };
}
```

### 7.9 融合架构总结

| 问题 | 答案 |
| :--- | :--- |
| **完全抄 Sovereign？** | ❌ 它只解决 ZK-Rollup，不支持异构链 |
| **完全用 Linux-style？** | ❌ 会缺少 StateMap 等开发者友好容器 |
| **融合两者？** | ✅ **Linux 骨架 + Sovereign 容器 = 最优解** |

**核心收益**:
- **Sovereign 的开发者体验** (StateMap, StateValue, Context)
- **Linux 的架构清晰度** (kernel/arch 分层)
- **Zig 的编译时性能** (comptime 零开销抽象)

**参考资料**:
- [Sovereign SDK GitHub](https://github.com/Sovereign-Labs/sovereign-sdk)
- [sov-state Documentation](https://docs.rs/sov-state/latest/sov_state/)
- [The Sovereign SDK Book](https://docs.sovereign.xyz/)

## 8. libtitan: 通用区块链运行时引擎 (Universal Runtime)

### 8.1 战略升级：从框架到引擎

**核心构想**: 将 Titan Framework 的 Zig 核心封装成 **C ABI 接口**，创造 `libtitan`。

这意味着：**任何能调用 C 的语言，都可以通过 Titan 开发区块链合约。**

> **这就是操作系统的设计思路。**
>
> 想象一下：**Linux 内核是用 C 写的**，但你可以在上面跑 Python、JS、Go、Rust。
> 为什么？因为 Linux 内核暴露了 **Syscalls (系统调用)** 接口。
>
> **Titan Framework (Zig Core)** 现在扮演的就是 **"区块链上的微内核"** 的角色。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    libtitan: 区块链微内核 (Blockchain Microkernel)           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  设计哲学: "Linux Syscall" 模式                                             │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                                                                      │   │
│  │  Linux 内核 (C) ─────暴露 Syscalls────→ Python/Go/Rust/JS 都能跑    │   │
│  │                                                                      │   │
│  │  libtitan (Zig) ────暴露 C ABI────→ Swift/Go/Rust/Nim 都能用        │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  定位升级:                                                                  │
│                                                                             │
│  之前: Titan Framework = Zig 开发框架 (单一语言)                            │
│  现在: libtitan = 通用区块链运行时 (万语言支持)                             │
│                                                                             │
│  类比:                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  LLVM 没有强迫大家用 C++                                             │   │
│  │  → 它暴露接口，Rust/Swift/Zig 都在用它                              │   │
│  │                                                                      │   │
│  │  libtitan 不强迫大家用 Zig                                           │   │
│  │  → 它暴露 C 接口，Swift/Go/Rust/Nim 都可以用它                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  核心层 (The Kernel): libtitan (Zig)                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  职责: 脏活累活全包                                                  │   │
│  │  • 管理只有 32KB 的堆内存 (Bump Allocator)                           │   │
│  │  • 处理 Solana/TON 的系统调用 (Log, CPI, Sysvar)                    │   │
│  │  • 处理入口点 (Entrypoint) 和参数序列化                              │   │
│  │                                                                      │   │
│  │  形式: 编译为静态库 (libtitan.a) 或 Wasm 模块                        │   │
│  │  接口: 纯 C 头文件 (titan.h)                                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.2 语言兼容性三梯队 (Three-Tier Language Compatibility)

只要其他语言能做到一件事：**"调用 C 函数 (FFI) 并编译成二进制/Wasm"**，它们就能加入生态。

#### 8.2.1 第一梯队：原生编译语言 (Native Compiled)

**代表语言**: Swift, Rust, TinyGo, Nim, C++, Zig, C

**兼容性等级**: ⭐⭐⭐⭐⭐ (完美)

这些语言天生支持编译成机器码，并且能**零损耗**调用 C。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    第一梯队: 原生编译语言 (Zero-Overhead)                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Swift (iOS 开发者 - 几百万人):                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  • Swift 可以直接 import C                                           │   │
│  │  • 只需要写一个 Package.swift 包装 titan.h                           │   │
│  │  • 结果: iOS 开发者用 Swift 语法写 Solana 合约                       │   │
│  │  • 性能: 编译出来的二进制和 Zig 一样小!                              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Rust (Rust 开发者 - 几十万人):                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  • extern "C" 直接调用                                               │   │
│  │  • 比 Anchor 更简洁，不需要复杂宏                                    │   │
│  │  • 结果: Rust 开发者绕过 Anchor 直接用 libtitan                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  TinyGo (Go 开发者 - 几百万人):                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  • 标准 Go 太大，但 TinyGo 专为嵌入式设计                            │   │
│  │  • TinyGo 通过 cgo 调用 Zig 库                                       │   │
│  │  • 结果: Go 程序员终于可以不用 Rust 也能写高性能合约了              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Nim (小众但硬核):                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  • Nim 有出色的 C FFI 支持                                           │   │
│  │  • 语法简洁类似 Python，编译性能接近 C                               │   │
│  │  • 结果: Nim 社区新的应用场景                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 8.2.2 第二梯队：脚本语言 (Scripting Languages via AOT)

**代表语言**: TypeScript (AssemblyScript), Python (Codon/Cython), Lua

**兼容性等级**: ⭐⭐⭐ (需要特殊手段)

> **巨大的技术陷阱**: 你不能直接把 `node` 或 `python` 解释器搬上链（太重了）。
> 所以，对于这些语言，策略是 **"AOT 编译 (Ahead-of-Time)"**。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    第二梯队: 脚本语言 (AOT Compilation)                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  TypeScript → AssemblyScript:                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  • AssemblyScript 是 TS 的子集，可编译成 Wasm                        │   │
│  │  • 让 AssemblyScript 导入 Zig Wasm Host Functions                    │   │
│  │  • 结果: 前端开发者用 TS 写合约，底层跑在 Zig 运行时上               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Python → Codon / Cython:                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  • 不能用标准的 CPython (太重)                                       │   │
│  │  • 使用 Codon (高性能 Python 编译器) 或 Cython                       │   │
│  │  • 把 Python 语法编译成 C/LLVM IR，然后链接 libtitan                 │   │
│  │  • 结果: 看起来是 Python，跑起来是原生机器码!                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Lua → LuaJIT FFI:                                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  • LuaJIT 有高效的 FFI 库                                            │   │
│  │  • 游戏开发者熟悉的语言                                              │   │
│  │  • 结果: 游戏开发者进入 Web3                                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 8.2.3 五大语言阵营: 万语归一 (Five Language Camps)

> **核心洞察**: C 语言的 ABI 就是编程界的"英语"——通用语。
> 只要是能在地球上叫得出名字的主流编程语言，**99% 都支持 C 语言接口 (FFI)**。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    万语归一: 星形拓扑架构 (Star Topology)                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                              ┌─────────┐                                    │
│                              │  Swift  │                                    │
│                              │  (iOS)  │                                    │
│                              └────┬────┘                                    │
│                                   │                                         │
│      ┌─────────┐            ┌─────┴─────┐            ┌─────────┐           │
│      │  Mojo   │            │           │            │ Kotlin  │           │
│      │  (AI)   │────────────│  libtitan │────────────│(Android)│           │
│      └─────────┘            │  (Zig)    │            └─────────┘           │
│                             │           │                                   │
│      ┌─────────┐            └─────┬─────┘            ┌─────────┐           │
│      │   Nim   │                  │                  │  Dart   │           │
│      │(Systems)│──────────────────┼──────────────────│(Flutter)│           │
│      └─────────┘                  │                  └─────────┘           │
│                                   │                                         │
│                              ┌────┴────┐                                    │
│                              │ TinyGo  │                                    │
│                              │  (Go)   │                                    │
│                              └─────────┘                                    │
│                                                                             │
│  Titan Core (Zig) 是太阳，其他语言是围绕它的行星                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**阵营 1: 移动端大军 (The Mobile Army)** - Web3 最缺的开发者群体

| 语言 | 现状 | 前景 |
| :--- | :--- | :--- |
| **Swift** (iOS/macOS) | 苹果生态封闭，但 Swift 可直接调用 C | 几百万 iOS 开发者用熟悉的语法写 Solana 合约 |
| **Kotlin** (Android) | Kotlin Native 支持 C Interop | Android 开发者也能进场 |
| **Dart** (Flutter) | Dart FFI 极其成熟 | 全栈开发者用 Flutter 写前端 + Dart 写合约 |

**阵营 2: 系统级新贵 (Modern Systems Languages)** - 追求高性能

| 语言 | 特点 | 适配难度 |
| :--- | :--- | :---: |
| **Nim** | 语法像 Python，性能像 C，先编译成 C 代码 | **极低** |
| **Odin** | 专为游戏开发设计，无 GC，类似 Zig | 低 |
| **V (Vlang)** | 1 秒编译 100 万行代码，二进制极小 | 低 |

**阵营 3: Web 开发巨头 (The Web Giants)** - 最大存量市场

| 语言 | 方案 | 杀伤力 |
| :--- | :--- | :--- |
| **AssemblyScript** | TS 严格子集 → Wasm → 调用 Zig Host Functions | 直接收编 **2000 万** JS/TS 开发者 |

**阵营 4: 游戏与嵌入式 (Game & Embedded)** - 链上游戏赛道

| 语言 | 场景 | 结合点 |
| :--- | :--- | :--- |
| **Lua** (Terra/Pallene) | 游戏行业标准脚本 | Terra 可与 C 互操作 |
| **TinyGo** | 为微控制器设计，体积小 | 适合寸土寸金的区块链空间 |

**阵营 5: AI 浪潮 (The AI Wave)** - 最大叙事

| 语言 | 特点 | 战略价值 |
| :--- | :--- | :--- |
| **Mojo** | Python 超集，比 Python 快 35000 倍 | 垄断 "链上 AI 模型推理" 开发入口 |

#### 8.2.4 LLVM 目标架构限制 (Target Architecture Constraint)

> **硬性条件**: 语言必须能编译成目标平台的架构 (LLVM target)。

| 语言 | 编译基础设施 | SBF (Solana) | Wasm | 可行性 |
| :---: | :--- | :---: | :---: | :---: |
| **Swift** | LLVM | ✅ | ✅ | **可行** |
| **TinyGo** | LLVM | ✅ | ✅ | **可行** |
| **Mojo** | LLVM/MLIR | ✅ | ✅ | **可行** |
| **Nim** | C → LLVM | ✅ | ✅ | **可行** |
| **Rust** | LLVM | ✅ | ✅ | **可行** |
| **Kotlin Native** | LLVM | ✅ | ✅ | **可行** |
| **Odin** | LLVM | ✅ | ✅ | **可行** |
| **V** | C → LLVM | ✅ | ✅ | **可行** |
| **Dart** | 自有编译器 | ❓ | ✅ | **部分可行** |
| **Java/C#** | JVM/CLR (几十兆) | ❌ | ❌ | **暂不可行** |

> **注**: Java/C# 依赖庞大的虚拟机，很难把几十兆的运行时塞进区块链。
> 除非使用 NativeAOT 技术 (如 GraalVM Native Image, .NET NativeAOT)。

#### 8.2.5 语言兼容性完整速查表

| 语言 | 阵营 | 梯队 | 兼容路径 | 目标人群 | 规模 | LLVM |
| :--- | :--- | :---: | :--- | :--- | :--- | :---: |
| **Zig** | 原生 | T0 | 直接使用 | Zig 开发者 | 万级 | ✅ |
| **C** | 原生 | T0 | 直接链接 | 系统程序员 | 百万级 | ✅ |
| **Swift** | 移动端 | T1 | import C | iOS 开发者 | 百万级 | ✅ |
| **Kotlin** | 移动端 | T1 | Kotlin Native | Android 开发者 | 百万级 | ✅ |
| **Dart** | 移动端 | T2 | dart:ffi | Flutter 开发者 | 十万级 | ⚠️ |
| **Rust** | 系统级 | T1 | extern "C" | Rust 开发者 | 十万级 | ✅ |
| **Nim** | 系统级 | T1 | C FFI | Nim 社区 | 万级 | ✅ |
| **Odin** | 系统级 | T1 | C FFI | 游戏开发者 | 万级 | ✅ |
| **V** | 系统级 | T1 | C 后端 | 新兴社区 | 万级 | ✅ |
| **C++** | 系统级 | T1 | extern "C" | 游戏/系统开发者 | 百万级 | ✅ |
| **TinyGo** | 嵌入式 | T1 | cgo | Go 开发者 | 百万级 | ✅ |
| **AssemblyScript** | Web | T2 | Wasm Host | 前端开发者 | **千万级** | ✅ |
| **Python** | AI | T2 | Codon/Cython | 数据科学家 | **千万级** | ✅ |
| **Mojo** | AI | T1 | C FFI | AI 开发者 | 十万级 | ✅ |
| **Lua** | 游戏 | T2 | Terra/LuaJIT | 游戏开发者 | 十万级 | ⚠️ |

#### 8.2.6 战略收编路线图 (Strategic Recruitment Roadmap)

按照 **"开发者红利 × 技术可行性"** 的优先级：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    libtitan 语言收编路线图                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Tier 0: 亲儿子 (Native Sons) - 性能基准                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Zig        → 直接使用，零开销                                       │   │
│  │  Roc        → 函数式入口 (V3+ 可选插件)                              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Tier 1: 优先支持 (Priority Support) - 巨大存量 + LLVM 支持好              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Swift      → iOS 百万级存量，LLVM 原生支持 SBF                      │   │
│  │  Kotlin     → Android 百万级存量，Kotlin Native 成熟                 │   │
│  │  Mojo       → AI x Crypto 最大叙事，MLIR 高性能                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Tier 2: 重点突破 (Key Breakthrough) - 最大规模市场                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  AssemblyScript → 2000 万 JS/TS 开发者，Wasm 生态成熟                │   │
│  │  Python (Codon) → 千万级数据科学家，AI 应用入口                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Tier 3: 生态扩展 (Ecosystem Extension) - 社区驱动                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  TinyGo     → Go 开发者，谷歌系                                      │   │
│  │  Nim        → 系统程序员，Python 语法                                │   │
│  │  Odin       → GameFi 开发，Zig 类似                                  │   │
│  │  Lua/Terra  → 链上游戏脚本                                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  做成 libtitan C 接口后:                                                    │
│  你不再只是 "Zig 框架作者"                                                  │
│  你是 "多语言区块链开发协议" 的制定者                                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.3 架构设计

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         libtitan 三层架构                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Layer 3: Guest Languages (用户层)                                          │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐  │
│  │  Swift  │ │  Rust   │ │ TinyGo  │ │   Nim   │ │  Zig    │ │   C     │  │
│  │  SDK    │ │  SDK    │ │  SDK    │ │  SDK    │ │  SDK    │ │  SDK    │  │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘  │
│       │          │          │          │          │          │           │
│       └──────────┴──────────┴────┬─────┴──────────┴──────────┘           │
│                                  │                                        │
│  Layer 2: C ABI Bridge (接口层)  │                                        │
│  ┌───────────────────────────────┴───────────────────────────────────┐   │
│  │                         titan.h                                    │   │
│  │                                                                    │   │
│  │  // Memory                                                         │   │
│  │  void* titan_alloc(size_t size);                                  │   │
│  │  void  titan_free(void* ptr);                                     │   │
│  │                                                                    │   │
│  │  // Storage                                                        │   │
│  │  int   titan_storage_read(const char* key, void* buf, size_t len);│   │
│  │  int   titan_storage_write(const char* key, void* buf, size_t len);│  │
│  │                                                                    │   │
│  │  // Context                                                        │   │
│  │  void  titan_get_sender(uint8_t* out_addr);                       │   │
│  │  uint64_t titan_get_value(void);                                  │   │
│  │                                                                    │   │
│  │  // Actions                                                        │   │
│  │  int   titan_transfer(const uint8_t* to, uint64_t amount);        │   │
│  │  void  titan_log(const char* msg, size_t len);                    │   │
│  │  int   titan_call(const uint8_t* target, void* data, size_t len); │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                                  │                                        │
│  Layer 1: Titan Core (核心层)    │                                        │
│  ┌───────────────────────────────┴───────────────────────────────────┐   │
│  │                    Pure Zig Implementation                         │   │
│  │                                                                    │   │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐               │   │
│  │  │ TitanAllocator│ │   Context   │ │   Storage    │               │   │
│  │  └──────────────┘ └──────────────┘ └──────────────┘               │   │
│  │                         │                                          │   │
│  │           ┌─────────────┴─────────────┐                           │   │
│  │           ▼                           ▼                           │   │
│  │  ┌──────────────┐           ┌──────────────┐                      │   │
│  │  │ arch/solana  │           │  arch/evm    │  ...                 │   │
│  │  └──────────────┘           └──────────────┘                      │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.3 C ABI 导出实现

Zig 对 C 的兼容性是所有语言里最好的。使用 `export` 关键字即可导出 C 函数。

```zig
// titan/exports.zig - libtitan C ABI 导出

const std = @import("std");
const target = @import("build_options").target_chain;
const context = @import("kernel/context.zig");
const storage = @import("kernel/syscalls.zig");
const allocator = @import("kernel/allocator.zig");

// ============================================================================
// Memory Management
// ============================================================================

/// 分配内存
export fn titan_alloc(size: usize) ?*anyopaque {
    return allocator.titan_allocator.alloc(u8, size) catch null;
}

/// 释放内存 (在 Bump Allocator 中可能是 no-op)
export fn titan_free(ptr: ?*anyopaque) void {
    // Bump allocator: no-op, 或标记为可回收
    _ = ptr;
}

/// 重新分配内存
export fn titan_realloc(ptr: ?*anyopaque, old_size: usize, new_size: usize) ?*anyopaque {
    return allocator.titan_allocator.realloc(ptr, old_size, new_size) catch null;
}

// ============================================================================
// Storage Operations
// ============================================================================

/// 读取存储
export fn titan_storage_read(
    key_ptr: [*]const u8,
    key_len: usize,
    buf_ptr: [*]u8,
    buf_len: usize,
) i32 {
    const key = key_ptr[0..key_len];
    const buf = buf_ptr[0..buf_len];

    if (comptime target == .solana) {
        return storage.solana_storage_read(key, buf);
    } else if (comptime target == .evm) {
        return storage.evm_storage_read(key, buf);
    } else if (comptime target == .ton) {
        return storage.ton_storage_read(key, buf);
    } else {
        return storage.wasm_storage_read(key, buf);
    }
}

/// 写入存储
export fn titan_storage_write(
    key_ptr: [*]const u8,
    key_len: usize,
    val_ptr: [*]const u8,
    val_len: usize,
) i32 {
    const key = key_ptr[0..key_len];
    const val = val_ptr[0..val_len];

    if (comptime target == .solana) {
        return storage.solana_storage_write(key, val);
    } else if (comptime target == .evm) {
        return storage.evm_storage_write(key, val);
    } else if (comptime target == .ton) {
        return storage.ton_storage_write(key, val);
    } else {
        return storage.wasm_storage_write(key, val);
    }
}

// ============================================================================
// Context Operations
// ============================================================================

/// 获取调用者地址
export fn titan_get_sender(out_addr: [*]u8) void {
    const ctx = context.Context.init();
    const addr_bytes = ctx.sender.toBytes();
    @memcpy(out_addr, &addr_bytes, addr_bytes.len);
}

/// 获取附带的原生代币数量
export fn titan_get_value() u64 {
    const ctx = context.Context.init();
    return @truncate(ctx.value);
}

/// 获取当前时间戳
export fn titan_get_timestamp() u64 {
    const ctx = context.Context.init();
    return ctx.timestamp;
}

/// 获取当前区块高度
export fn titan_get_block_height() u64 {
    const ctx = context.Context.init();
    return ctx.block_height;
}

// ============================================================================
// Actions
// ============================================================================

/// 转账原生代币
export fn titan_transfer(to_addr: [*]const u8, amount: u64) i32 {
    var ctx = context.Context.init();
    const to = context.Address.fromBytes(to_addr[0..32]);
    ctx.transfer(to, amount) catch return -1;
    return 0;
}

/// 输出日志
export fn titan_log(msg_ptr: [*]const u8, msg_len: usize) void {
    const msg = msg_ptr[0..msg_len];

    if (comptime target == .solana) {
        @import("arch/solana/log.zig").sol_log(msg);
    } else if (comptime target == .evm) {
        @import("arch/evm/log.zig").evm_log(msg);
    } else {
        std.log.info("{s}", .{msg});
    }
}

/// 调用其他合约
export fn titan_call(
    target_addr: [*]const u8,
    data_ptr: [*]const u8,
    data_len: usize,
    ret_ptr: [*]u8,
    ret_len: usize,
) i32 {
    const target_address = context.Address.fromBytes(target_addr[0..32]);
    const data = data_ptr[0..data_len];
    const ret_buf = ret_ptr[0..ret_len];

    var ctx = context.Context.init();
    const result = ctx.call(target_address, data, ret_buf) catch return -1;
    return @intCast(result);
}

/// 发出事件
export fn titan_emit_event(
    name_ptr: [*]const u8,
    name_len: usize,
    data_ptr: [*]const u8,
    data_len: usize,
) void {
    const name = name_ptr[0..name_len];
    const data = data_ptr[0..data_len];

    var ctx = context.Context.init();
    ctx.emit_raw(name, data);
}

// ============================================================================
// Compilation Service (for transpile targets)
// ============================================================================

/// 编译 AST 到 Yul (用于 EVM 目标)
/// 返回生成的 Yul 代码长度，-1 表示错误
export fn titan_compile_to_yul(
    ast_json_ptr: [*]const u8,
    ast_json_len: usize,
    out_ptr: [*]u8,
    out_max_len: usize,
) i32 {
    const ast_json = ast_json_ptr[0..ast_json_len];
    const out_buf = out_ptr[0..out_max_len];

    const yul_code = @import("arch/evm/yul_codegen.zig").compileFromJson(ast_json) catch return -1;
    if (yul_code.len > out_max_len) return -2; // buffer too small

    @memcpy(out_buf, yul_code, yul_code.len);
    return @intCast(yul_code.len);
}

/// 编译 AST 到 Fift (用于 TON 目标)
export fn titan_compile_to_fift(
    ast_json_ptr: [*]const u8,
    ast_json_len: usize,
    out_ptr: [*]u8,
    out_max_len: usize,
) i32 {
    const ast_json = ast_json_ptr[0..ast_json_len];
    const out_buf = out_ptr[0..out_max_len];

    const fift_code = @import("arch/ton/fift_codegen.zig").compileFromJson(ast_json) catch return -1;
    if (fift_code.len > out_max_len) return -2;

    @memcpy(out_buf, fift_code, fift_code.len);
    return @intCast(fift_code.len);
}
```

### 8.4 titan.h 头文件

```c
// titan.h - libtitan C ABI Header
// Generated from Zig exports

#ifndef TITAN_H
#define TITAN_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// ============================================================================
// Memory Management
// ============================================================================

void* titan_alloc(size_t size);
void  titan_free(void* ptr);
void* titan_realloc(void* ptr, size_t old_size, size_t new_size);

// ============================================================================
// Storage Operations
// ============================================================================

int titan_storage_read(
    const uint8_t* key, size_t key_len,
    uint8_t* buf, size_t buf_len
);

int titan_storage_write(
    const uint8_t* key, size_t key_len,
    const uint8_t* val, size_t val_len
);

// ============================================================================
// Context Operations
// ============================================================================

void     titan_get_sender(uint8_t* out_addr);  // 32 bytes
uint64_t titan_get_value(void);
uint64_t titan_get_timestamp(void);
uint64_t titan_get_block_height(void);

// ============================================================================
// Actions
// ============================================================================

int  titan_transfer(const uint8_t* to_addr, uint64_t amount);
void titan_log(const char* msg, size_t len);
int  titan_call(
    const uint8_t* target_addr,
    const uint8_t* data, size_t data_len,
    uint8_t* ret_buf, size_t ret_len
);
void titan_emit_event(
    const char* name, size_t name_len,
    const uint8_t* data, size_t data_len
);

// ============================================================================
// Compilation Service (for tooling)
// ============================================================================

int titan_compile_to_yul(
    const char* ast_json, size_t ast_len,
    char* out_buf, size_t out_max_len
);

int titan_compile_to_fift(
    const char* ast_json, size_t ast_len,
    char* out_buf, size_t out_max_len
);

#ifdef __cplusplus
}
#endif

#endif // TITAN_H
```

### 8.6 多语言绑定示例

#### 8.6.1 Swift on Solana: 完整工作流程 (Complete Workflow)

**端到端示例: iOS 开发者用 Swift 写 Solana 合约**

这个例子展示了三层架构如何协同工作：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Swift → Solana 完整编译流程                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Step 1: 用户写 Swift 代码                                                  │
│        │                                                                    │
│        ▼                                                                    │
│  Step 2: Swift 编译器生成 .o (目标文件)                                     │
│        │                                                                    │
│        │    libtitan.a (Zig 编译的静态库)                                   │
│        │         │                                                          │
│        └────┬────┘                                                          │
│             │                                                               │
│             ▼                                                               │
│  Step 3: Linker (链接器) 合并                                               │
│             │                                                               │
│             ▼                                                               │
│  Step 4: 输出 .so (Solana) 或 .wasm (Near/Cosmos)                          │
│                                                                             │
│  关键: Swift 调用 Zig，Zig 调用 Solana Syscall                              │
│  性能: 和 Rust/Zig 原生代码 **没有任何区别**                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Layer 1: Zig 核心 (Provider) - 底层脏活累活**

```zig
// titan/exports.zig - libtitan 核心
export fn titan_log(msg: [*]const u8, len: usize) void {
    // 调用 Solana 底层 log syscall
    @import("arch/solana/log.zig").sol_log(msg[0..len]);
}

export fn titan_alloc(size: usize) ?*anyopaque {
    return allocator.titan_allocator.alloc(u8, size) catch null;
}

export fn titan_get_sender(out_addr: [*]u8) void {
    const ctx = context.Context.init();
    const addr_bytes = ctx.sender.toBytes();
    @memcpy(out_addr, &addr_bytes, addr_bytes.len);
}
```

**Layer 2: Swift 绑定 (User Wrapper) - 语法糖封装**

```swift
// TitanSwift/Sources/Titan.swift
// 这是一个极简的包装层，Swift 开发者只需要引用这个库

import Foundation

// C 函数声明 - 使用 @_silgen_name 直接绑定
@_silgen_name("titan_log")
func c_titan_log(_ msg: UnsafePointer<UInt8>, _ len: Int)

@_silgen_name("titan_get_sender")
func c_titan_get_sender(_ out: UnsafeMutablePointer<UInt8>)

@_silgen_name("titan_storage_read")
func c_titan_storage_read(_ key: UnsafePointer<UInt8>, _ keyLen: Int,
                          _ buf: UnsafeMutablePointer<UInt8>, _ bufLen: Int) -> Int32

@_silgen_name("titan_storage_write")
func c_titan_storage_write(_ key: UnsafePointer<UInt8>, _ keyLen: Int,
                           _ val: UnsafePointer<UInt8>, _ valLen: Int) -> Int32

// 高级 API - 自动把 Swift 类型转成 C 指针传给 Zig
public enum Titan {
    public static func log(_ message: String) {
        var msg = message
        msg.withUTF8 { ptr in
            c_titan_log(ptr.baseAddress!, ptr.count)
        }
    }

    public static func getSender() -> [UInt8] {
        var addr = [UInt8](repeating: 0, count: 32)
        c_titan_get_sender(&addr)
        return addr
    }
}

public class TitanContext {
    public static func getSender() -> [UInt8] {
        var addr = [UInt8](repeating: 0, count: 32)
        c_titan_get_sender(&addr)
        return addr
    }

    public static func log(_ message: String) {
        message.withCString { ptr in
            c_titan_log(UnsafePointer<UInt8>(OpaquePointer(ptr)), message.utf8.count)
        }
    }
}

public class TitanStorage {
    public static func read(key: String) -> Data? {
        var buffer = [UInt8](repeating: 0, count: 1024)
        let result = key.withCString { keyPtr in
            c_titan_storage_read(UnsafePointer<UInt8>(OpaquePointer(keyPtr)),
                                 key.utf8.count, &buffer, buffer.count)
        }
        if result < 0 { return nil }
        return Data(buffer[0..<Int(result)])
    }

    public static func write(key: String, value: Data) throws {
        let result = key.withCString { keyPtr in
            value.withUnsafeBytes { valPtr in
                c_titan_storage_write(UnsafePointer<UInt8>(OpaquePointer(keyPtr)),
                                      key.utf8.count,
                                      valPtr.bindMemory(to: UInt8.self).baseAddress!,
                                      value.count)
            }
        }
        if result != 0 {
            throw TitanError.writeFailed
        }
    }
}

public enum TitanError: Error {
    case transferFailed
    case writeFailed
}
```

**Layer 3: 用户合约 (User Code) - 纯粹业务逻辑**

```swift
// MyContract.swift - 用户写的合约代码
import Titan

@_cdecl("entrypoint")  // 告诉编译器这是入口点
public func main() -> UInt64 {
    Titan.log("Hello Solana from Swift!")

    let sender = TitanContext.getSender()
    let key = "balance:\(sender.hexString)"

    if let balanceData = TitanStorage.read(key: key) {
        // 业务逻辑...
        let balance = balanceData.withUnsafeBytes { $0.load(as: UInt64.self) }
        Titan.log("Current balance: \(balance)")
    }

    return 0  // 成功
}

// Helper extension
extension Array where Element == UInt8 {
    var hexString: String {
        return map { String(format: "%02x", $0) }.joined()
    }
}
```

**编译命令:**

```bash
# 1. 编译 libtitan (Zig → 静态库)
zig build -Dtarget_chain=solana -Drelease
# 输出: zig-out/lib/libtitan.a

# 2. 编译 Swift 合约
swiftc -emit-object -target sbf-solana-solana \
    -I./include \           # titan.h 所在目录
    MyContract.swift \
    -o MyContract.o

# 3. 链接生成最终二进制
ld.lld --shared \
    MyContract.o \
    libtitan.a \
    -o my_contract.so

# 4. 部署到 Solana
solana program deploy my_contract.so
```

**发生了什么？**

1. iOS 开发者用熟悉的 Swift 语法写代码
2. Swift 编译器生成 `.o` 目标文件
3. 链接器把 `swift.o` 和 `libtitan.a` 合并
4. 生成的 `.so` 文件直接部署到 Solana
5. **性能与 Rust/Zig 原生代码完全相同** (零 FFI 开销)

#### 8.6.2 Rust (简化版，绕过 Anchor)

```rust
// titan-rust/src/lib.rs

use std::ffi::c_void;

extern "C" {
    fn titan_alloc(size: usize) -> *mut c_void;
    fn titan_storage_read(key: *const u8, key_len: usize, buf: *mut u8, buf_len: usize) -> i32;
    fn titan_storage_write(key: *const u8, key_len: usize, val: *const u8, val_len: usize) -> i32;
    fn titan_get_sender(out: *mut u8);
    fn titan_transfer(to: *const u8, amount: u64) -> i32;
    fn titan_log(msg: *const u8, len: usize);
}

pub struct Context;

impl Context {
    pub fn sender() -> [u8; 32] {
        let mut addr = [0u8; 32];
        unsafe { titan_get_sender(addr.as_mut_ptr()) };
        addr
    }

    pub fn transfer(to: &[u8; 32], amount: u64) -> Result<(), &'static str> {
        let result = unsafe { titan_transfer(to.as_ptr(), amount) };
        if result == 0 { Ok(()) } else { Err("transfer failed") }
    }

    pub fn log(msg: &str) {
        unsafe { titan_log(msg.as_ptr(), msg.len()) };
    }
}

pub struct Storage;

impl Storage {
    pub fn read(key: &str) -> Option<Vec<u8>> {
        let mut buf = vec![0u8; 1024];
        let result = unsafe {
            titan_storage_read(key.as_ptr(), key.len(), buf.as_mut_ptr(), buf.len())
        };
        if result < 0 { None } else {
            buf.truncate(result as usize);
            Some(buf)
        }
    }

    pub fn write(key: &str, value: &[u8]) -> Result<(), &'static str> {
        let result = unsafe {
            titan_storage_write(key.as_ptr(), key.len(), value.as_ptr(), value.len())
        };
        if result == 0 { Ok(()) } else { Err("write failed") }
    }
}

// 用户合约 - 比 Anchor 简洁 10 倍
#[no_mangle]
pub extern "C" fn entrypoint() {
    Context::log("Hello from Rust via libtitan!");

    let sender = Context::sender();
    let key = format!("balance:{:?}", sender);

    if let Some(balance) = Storage::read(&key) {
        // 业务逻辑...
    }
}
```

#### 8.6.3 TinyGo on Wasm

```go
// titan-go/titan.go

package titan

/*
#include "titan.h"
*/
import "C"
import "unsafe"

func GetSender() [32]byte {
    var addr [32]byte
    C.titan_get_sender((*C.uint8_t)(unsafe.Pointer(&addr[0])))
    return addr
}

func GetValue() uint64 {
    return uint64(C.titan_get_value())
}

func Transfer(to [32]byte, amount uint64) error {
    result := C.titan_transfer((*C.uint8_t)(unsafe.Pointer(&to[0])), C.uint64_t(amount))
    if result != 0 {
        return errors.New("transfer failed")
    }
    return nil
}

func Log(msg string) {
    cstr := C.CString(msg)
    defer C.free(unsafe.Pointer(cstr))
    C.titan_log(cstr, C.size_t(len(msg)))
}

func StorageRead(key string) ([]byte, error) {
    buf := make([]byte, 1024)
    ckey := C.CString(key)
    defer C.free(unsafe.Pointer(ckey))

    result := C.titan_storage_read(
        (*C.uint8_t)(unsafe.Pointer(ckey)), C.size_t(len(key)),
        (*C.uint8_t)(unsafe.Pointer(&buf[0])), C.size_t(len(buf)),
    )
    if result < 0 {
        return nil, errors.New("read failed")
    }
    return buf[:result], nil
}

// 用户合约
//export entrypoint
func entrypoint() {
    titan.Log("Hello from Go via libtitan!")

    sender := titan.GetSender()
    balance, _ := titan.StorageRead(fmt.Sprintf("balance:%x", sender))
    // 业务逻辑...
}

func main() {} // Required for TinyGo
```

### 8.7 两种路径的适配策略

#### 8.7.1 原生路径 (Solana / Wasm) - Runtime Binding

```
┌─────────────────────────────────────────────────────────────────┐
│              原生路径: 真·多语言混合编译                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Swift/Rust/Go 源码                                             │
│        │                                                        │
│        ▼                                                        │
│  编译为 .o (目标文件)                                           │
│        │                                                        │
│        │    libtitan.a (Zig 编译)                               │
│        │         │                                              │
│        └────┬────┘                                              │
│             │                                                   │
│             ▼                                                   │
│      Linker (链接器)                                            │
│             │                                                   │
│             ▼                                                   │
│   ┌─────────────────┐                                          │
│   │  .so (Solana)   │  或  .wasm (Near/Cosmos/Stylus)          │
│   └─────────────────┘                                          │
│                                                                 │
│   效果: Swift 调用 Zig，Zig 调用 Solana Syscall                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### 8.7.2 转译路径 (TON / EVM) - Compiler Service

```
┌─────────────────────────────────────────────────────────────────┐
│              转译路径: 编译服务库                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  因为 EVM/TON 需要生成源码 (Yul/Fift)，不能直接链接二进制       │
│                                                                 │
│  Python/JS 工具                                                 │
│        │                                                        │
│        │ 调用 libtitan.dll/so                                   │
│        │                                                        │
│        ▼                                                        │
│  ┌─────────────────────────────────────────┐                   │
│  │  titan_compile_to_yul(ast_json)         │                   │
│  │  titan_compile_to_fift(ast_json)        │                   │
│  └─────────────────────────────────────────┘                   │
│        │                                                        │
│        ▼                                                        │
│  返回生成的 Yul/Fift 源码                                       │
│        │                                                        │
│        ▼                                                        │
│  官方编译器 (solc / fift)                                       │
│        │                                                        │
│        ▼                                                        │
│   .bin (EVM) / .boc (TON)                                       │
│                                                                 │
│  场景: IDE 插件、CLI 工具、CI/CD 管道                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 8.8 "万国来朝" 生态效应

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    libtitan 生态效应: 万国来朝                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  语言绑定 (Language Bindings):                                              │
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │ titan-swift │  │ titan-rust  │  │ titan-go    │  │ titan-nim   │       │
│  │             │  │             │  │ (TinyGo)    │  │             │       │
│  │ iOS 开发者  │  │ Rust 开发者 │  │ Go 开发者   │  │ Nim 开发者  │       │
│  │ 几百万人    │  │ 几十万人    │  │ 几百万人    │  │ 小众但硬核  │       │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘       │
│                                                                             │
│  工具绑定 (Tool Bindings):                                                  │
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                         │
│  │ Python CLI  │  │ VS Code     │  │ GitHub      │                         │
│  │ titan-cli   │  │ Extension   │  │ Actions     │                         │
│  │             │  │             │  │             │                         │
│  │ 调用        │  │ 调用        │  │ 调用        │                         │
│  │ libtitan    │  │ libtitan    │  │ libtitan    │                         │
│  └─────────────┘  └─────────────┘  └─────────────┘                         │
│                                                                             │
│  战略价值:                                                                  │
│                                                                             │
│  1. 网络效应: 社区自发创建各语言绑定                                       │
│  2. 技术护城河: 所有语言最终依赖 Zig 核心                                  │
│  3. 生态锁定: 一旦用了 libtitan，切换成本极高                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.9 实现路线图

| 阶段 | 任务 | 优先级 |
| :--- | :--- | :---: |
| **Phase 1** | Zig 核心完成 (Storage, Context, Router) | P0 |
| **Phase 2** | 导出 C ABI (`export fn`) | P0 |
| **Phase 3** | 生成 `titan.h` 头文件 | P0 |
| **Phase 4** | 编译为 `libtitan.a` 静态库 | P1 |
| **Phase 5** | 验证: C 程序调用 libtitan | P1 |
| **Phase 6** | 验证: Rust FFI 调用 libtitan | P1 |
| **Phase 7** | titan-swift SDK 原型 | P2 |
| **Phase 8** | titan-go (TinyGo) SDK 原型 | P2 |

### 8.10 "降维打击" 战略定位 (Strategic Position)

如果说：

- **Anchor (Rust)** 是给 Rust 程序员用的工具
- **Seahorse (Python)** 是生成 Rust 代码的玩具

那么 **Titan Framework (C-ABI)** 就是 **"区块链通天塔"**。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         降维打击: 对比分析                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  竞品分析:                                                                  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Anchor (Rust-only)                                                  │   │
│  │  • 只服务 Rust 开发者                                                │   │
│  │  • 学习曲线陡峭                                                      │   │
│  │  • 市场: Rust 开发者 (十万级)                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Seahorse (Python → Rust)                                            │   │
│  │  • Python 语法生成 Rust 代码                                         │   │
│  │  • 功能受限，玩具级别                                                │   │
│  │  • 市场: 想要入门的 Python 开发者                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Titan Framework (C-ABI, Universal)                                  │   │
│  │  • 万语言支持: Swift/Rust/Go/Nim/C/C++/...                          │   │
│  │  • 真·原生性能: 零 FFI 开销                                          │   │
│  │  • 市场: 所有能调用 C 的开发者 (千万级)                              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  你不需要自己实现 Swift 编译器、Go 编译器、Python 编译器                   │
│  你只需要:                                                                  │
│                                                                             │
│  1. 守住底层: 用 Zig 把最难的内存管理、跨链适配做成最坚固的"地基"          │
│  2. 开放接口: 扔出一个 titan.h                                              │
│  3. 坐等生态: 社区自发过来写 Wrapper (Swift/Go/Nim/...)                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**结论: 只要兼容 C ABI，万物皆可 Titan。这才是真正的平台级思维。**

### 8.11 小结

```
┌───────────────────────────────────────────────────────────────────────────┐
│                      libtitan 战略价值                                     │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  之前: 你做了一个好用的锄头 (Zig Framework)                               │
│  现在: 你做了一个通用的 "农具手柄" (libtitan)                             │
│       别人可以在上面装锄头、镰刀、铲子                                    │
│                                                                           │
│  定位升级:                                                                │
│  • 开发框架 → 通用运行时引擎                                              │
│  • 单一语言 → 万语言支持                                                  │
│  • 工具 → 基础设施                                                        │
│                                                                           │
│  技术可行性: ✅ Zig 对 C ABI 的支持是所有语言中最好的                     │
│  商业可行性: ✅ 极大扩展目标用户群 (Swift/Go/Rust 开发者)                 │
│  生态可行性: ✅ 社区可自发创建语言绑定，降低维护成本                       │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

## 9. 结论

**一句话总结**:

> **Titan Framework = Zig comptime 多态 + 统一抽象层 + C ABI 万语言支持**
>
> **"Web3 时代的 LLVM" - 一个可以编译任何语言到任何链的通用运行时引擎**

```
┌───────────────────────────────────────────────────────────────────────────┐
│                   Titan Framework 完整价值主张                             │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  对于 Zig 开发者:                                                         │
│  • 只学一种语言，部署到所有链                                            │
│  • comptime 魔法自动处理跨链差异                                         │
│  • 真正的 "Write Once, Compile Anywhere"                                 │
│                                                                           │
│  对于其他语言开发者 (libtitan):                                           │
│  • Swift/Rust/Go 开发者可直接使用                                        │
│  • C ABI 绑定，零学习成本                                                │
│  • 享受 Zig 核心的性能和安全                                             │
│                                                                           │
│  对于项目方:                                                              │
│  • 工程复杂度最低                                                        │
│  • 调试和维护成本最低                                                    │
│  • 性能最优 (零运行时开销)                                               │
│                                                                           │
│  对于生态:                                                                │
│  • libtitan 成为 Web3 的 "LLVM"                                          │
│  • 万语言支持，万国来朝                                                  │
│  • 社区自发创建语言绑定                                                  │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

**行动指南**:

1. **Zig 核心**: 设计 `Titan SDK` 时，牢记**"多态 (Polymorphism)"**。每一个 API 都通过 `comptime switch (target)` 实现多种逻辑。

2. **C ABI 导出**: 完成 Zig 核心后，立即用 `export fn` 导出 C 接口，生成 `titan.h` 和 `libtitan.a`。

3. **验证路径**: 先用 C 程序调用 libtitan，验证 ABI 正确性；再用 Rust FFI 验证；最后开放社区创建更多语言绑定。
