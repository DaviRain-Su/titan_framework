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

## 8. 结论

**一句话总结**:

> **Titan Framework = Zig comptime 多态 + 统一抽象层**
>
> **"Web3 时代的 C 语言" - 一种可以编译到任何链底层的高性能语言**

```
┌───────────────────────────────────────────────────────────────────────────┐
│                      Pure Zig 架构价值主张                                 │
├───────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  对于开发者:                                                              │
│  • 只学一种语言，部署到所有链                                            │
│  • Zig 的 C 风格语法，学习曲线平缓                                       │
│  • comptime 魔法自动处理跨链差异                                         │
│                                                                           │
│  对于项目方:                                                              │
│  • 工程复杂度最低                                                        │
│  • 调试和维护成本最低                                                    │
│  • 性能最优 (零运行时开销)                                               │
│                                                                           │
│  对于生态:                                                                │
│  • Zig 成为 Web3 的"通用汇编语言"                                        │
│  • 统一的开发范式和工具链                                                │
│  • 真正的 "Write Once, Compile Anywhere"                                 │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

**行动指南**: 设计 `Titan SDK` 时，牢记**"多态 (Polymorphism)"**。每一个 API (`save`, `load`, `transfer`, `emit`) 都要在内部通过 `comptime switch (target)` 实现多种逻辑。
