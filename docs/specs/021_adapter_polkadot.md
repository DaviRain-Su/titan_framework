# 规范 021: Polkadot 适配器规范 (Ink!/Substrate Adapter)

本规范定义了 Titan OS 如何在底层对接 Polkadot 生态的 Substrate Contracts Pallet (ink!) 运行时。

**设计原则**: 将 Substrate 的 Seal API 和 SCALE 编码映射为统一资源/IO 语义。

> **状态**: 规划中 (V2/V3 Target)
> **依赖**: [018_multichain_storage.md](018_multichain_storage.md) (存储层实现)

## 1. 架构映射策略

Polkadot 使用 Substrate 框架，智能合约通过 Contracts Pallet 运行。ink! 是官方推荐的 Rust eDSL，但底层是纯 Wasm + Seal API。

| Titan 概念 | ink!/Substrate 概念 | 适配策略 |
| :--- | :--- | :--- |
| **Contract** | **ink! Contract** | 每个 Titan 合约映射为一个 Wasm 模块 |
| **Entrypoint** | **deploy / call** | `instantiate` -> `deploy`, `execute` -> `call` |
| **Message** | **Selector + SCALE** | 4 字节选择器 + SCALE 编码参数 |
| **Storage** | **Seal Storage** | 哈希键 + SCALE 编码值 |
| **Call** | **seal_call** | `titan.call` 映射为跨合约调用 |

## 2. 入口点映射 (Entry Points)

### 2.1 Wasm 导出函数

Substrate Contracts 只需要两个入口点：

```zig
// arch/wasm/substrate.zig

/// 合约部署 (构造函数)
export fn deploy() void {
    // 1. 读取输入 (SCALE 编码)
    const input = sealInput();

    // 2. 解析 selector (前 4 字节)
    const selector = input[0..4].*;
    const args = input[4..];

    // 3. 路由到对应的构造函数
    const result = dispatchConstructor(selector, args) catch |err| {
        sealReturn(ReturnFlags.REVERT, errorToScale(err));
        return;
    };

    // 4. 初始化成功
    sealReturn(ReturnFlags.empty(), result);
}

/// 合约调用 (方法)
export fn call() void {
    // 1. 读取输入
    const input = sealInput();

    // 2. 解析 selector
    const selector = input[0..4].*;
    const args = input[4..];

    // 3. 路由到对应的方法
    const result = dispatchMessage(selector, args) catch |err| {
        sealReturn(ReturnFlags.REVERT, errorToScale(err));
        return;
    };

    // 4. 返回结果
    sealReturn(ReturnFlags.empty(), result);
}
```

### 2.2 选择器计算 (Selector)

ink! 使用 Blake2 哈希的前 4 字节作为方法选择器：

```zig
/// 计算方法选择器
pub fn selector(comptime name: []const u8) [4]u8 {
    const hash = std.crypto.hash.blake2.Blake2b128.hash(name);
    return hash[0..4].*;
}

// 示例
const TRANSFER_SELECTOR = selector("transfer");  // 0x84a15da1
const BALANCE_OF_SELECTOR = selector("balance_of");
```

### 2.3 用户代码结构

```zig
pub const Contract = struct {
    // ===== 构造函数 =====

    /// 默认构造函数
    pub fn new(initial_supply: u128) !void {
        const caller = sealCaller();
        try Storage.setBalance(caller, initial_supply);
        try Storage.setTotalSupply(initial_supply);
    }

    // ===== 消息 (可变) =====

    /// 转账
    pub fn transfer(to: AccountId, value: u128) !void {
        const caller = sealCaller();
        try transferImpl(caller, to, value);
    }

    /// 授权
    pub fn approve(spender: AccountId, value: u128) !void {
        const caller = sealCaller();
        try Storage.setAllowance(caller, spender, value);
    }

    // ===== 查询 (不可变) =====

    /// 查询余额
    pub fn balance_of(owner: AccountId) u128 {
        return Storage.getBalance(owner);
    }

    /// 查询总供应量
    pub fn total_supply() u128 {
        return Storage.getTotalSupply();
    }
};
```

## 3. Seal API 宿主函数

### 3.1 核心宿主函数

```zig
// arch/wasm/substrate_imports.zig

// ===== 输入/输出 =====
extern "seal0" fn seal_input(buf_ptr: u32, buf_len_ptr: u32) void;
extern "seal0" fn seal_return(flags: u32, data_ptr: u32, data_len: u32) void;

// ===== 存储 =====
extern "seal1" fn seal_set_storage(
    key_ptr: u32,
    key_len: u32,
    value_ptr: u32,
    value_len: u32,
) u32;  // 返回: 0=插入, 1=覆盖

extern "seal1" fn seal_get_storage(
    key_ptr: u32,
    key_len: u32,
    out_ptr: u32,
    out_len_ptr: u32,
) u32;  // 返回: ReturnCode

extern "seal1" fn seal_contains_storage(key_ptr: u32, key_len: u32) u32;
extern "seal1" fn seal_clear_storage(key_ptr: u32, key_len: u32) u32;
extern "seal0" fn seal_take_storage(
    key_ptr: u32,
    key_len: u32,
    out_ptr: u32,
    out_len_ptr: u32,
) u32;  // 读取并删除

// ===== 环境 =====
extern "seal0" fn seal_caller(out_ptr: u32, out_len_ptr: u32) void;
extern "seal0" fn seal_address(out_ptr: u32, out_len_ptr: u32) void;
extern "seal0" fn seal_balance(out_ptr: u32, out_len_ptr: u32) void;
extern "seal0" fn seal_value_transferred(out_ptr: u32, out_len_ptr: u32) void;
extern "seal0" fn seal_now(out_ptr: u32, out_len_ptr: u32) void;
extern "seal0" fn seal_block_number(out_ptr: u32, out_len_ptr: u32) void;
extern "seal0" fn seal_minimum_balance(out_ptr: u32, out_len_ptr: u32) void;

// ===== 加密 =====
extern "seal0" fn seal_hash_sha2_256(input_ptr: u32, input_len: u32, out_ptr: u32) void;
extern "seal0" fn seal_hash_keccak_256(input_ptr: u32, input_len: u32, out_ptr: u32) void;
extern "seal0" fn seal_hash_blake2_256(input_ptr: u32, input_len: u32, out_ptr: u32) void;
extern "seal0" fn seal_hash_blake2_128(input_ptr: u32, input_len: u32, out_ptr: u32) void;
extern "seal0" fn seal_ecdsa_recover(
    sig_ptr: u32,
    msg_hash_ptr: u32,
    out_ptr: u32,
) u32;

// ===== 合约调用 =====
extern "seal1" fn seal_call(
    flags: u32,
    callee_ptr: u32,
    gas: u64,
    value_ptr: u32,
    input_ptr: u32,
    input_len: u32,
    out_ptr: u32,
    out_len_ptr: u32,
) u32;

extern "seal1" fn seal_instantiate(
    code_hash_ptr: u32,
    gas: u64,
    value_ptr: u32,
    input_ptr: u32,
    input_len: u32,
    address_ptr: u32,
    address_len_ptr: u32,
    out_ptr: u32,
    out_len_ptr: u32,
    salt_ptr: u32,
    salt_len: u32,
) u32;

extern "seal0" fn seal_terminate(beneficiary_ptr: u32) void;
extern "seal0" fn seal_transfer(
    dest_ptr: u32,
    dest_len: u32,
    value_ptr: u32,
    value_len: u32,
) u32;

// ===== 事件 =====
extern "seal0" fn seal_deposit_event(
    topics_ptr: u32,
    topics_len: u32,
    data_ptr: u32,
    data_len: u32,
) void;

// ===== 调试 =====
extern "seal0" fn seal_debug_message(str_ptr: u32, str_len: u32) u32;

// ===== 随机数 =====
extern "seal1" fn seal_random(
    subject_ptr: u32,
    subject_len: u32,
    out_ptr: u32,
    out_len_ptr: u32,
) void;
```

### 3.2 Titan API 映射

| Titan API | Seal API | 说明 |
| :--- | :--- | :--- |
| `titan.log(msg)` | `seal_debug_message` | 调试输出 |
| `titan.storage.get(k)` | `seal_get_storage` | 读取存储 |
| `titan.storage.set(k, v)` | `seal_set_storage` | 写入存储 |
| `titan.crypto.sha256(...)` | `seal_hash_sha2_256` | SHA256 哈希 |
| `titan.crypto.keccak256(...)` | `seal_hash_keccak_256` | Keccak256 哈希 |
| `titan.context.caller()` | `seal_caller` | 获取调用者 |
| `titan.context.value()` | `seal_value_transferred` | 获取转账金额 |
| `titan.call(...)` | `seal_call` | 跨合约调用 |

## 4. 序列化: SCALE 编解码

### 4.1 SCALE 简介

Substrate 使用 SCALE (Simple Concatenated Aggregate Little-Endian) 编码，这是一种紧凑的二进制格式。

### 4.2 类型映射

| Zig 类型 | SCALE 编码 | 字节数 |
| :--- | :--- | :--- |
| `bool` | `0x00` / `0x01` | 1 |
| `u8` | 直接存储 | 1 |
| `u16` | LE | 2 |
| `u32` | LE | 4 |
| `u64` | LE | 8 |
| `u128` | LE | 16 |
| `i8..i128` | 同上 (有符号) | 同上 |
| `Compact<u32>` | 变长编码 | 1-5 |
| `[]const u8` | 长度前缀 + 数据 | 变长 |
| `[N]u8` | 直接存储 | N |
| `?T` | `0x00` / `0x01 + T` | 变长 |
| `struct` | 字段按顺序 | 变长 |
| `enum` | 索引 + 变体数据 | 变长 |

### 4.3 Compact 编码

SCALE 的特色是 Compact 编码，用于节省常见小整数的空间：

```zig
/// Compact<u32> 编码规则
pub fn encodeCompact(value: u32) []u8 {
    if (value < 0x40) {
        // 单字节模式: 0b00xxxxxx
        return &[_]u8{@intCast(value << 2)};
    } else if (value < 0x4000) {
        // 双字节模式: 0b01xxxxxx xxxxxxxx
        const v = (value << 2) | 0x01;
        return std.mem.asBytes(&std.mem.nativeToLittle(u16, @intCast(v)));
    } else if (value < 0x40000000) {
        // 四字节模式: 0b10xxxxxx xxxxxxxx xxxxxxxx xxxxxxxx
        const v = (value << 2) | 0x02;
        return std.mem.asBytes(&std.mem.nativeToLittle(u32, v));
    } else {
        // 大整数模式: 0b11xxxxxx + 后续字节
        // ...
    }
}
```

### 4.4 Titan SCALE 模块

```zig
pub const scale = struct {
    /// 编码
    pub fn encode(comptime T: type, value: T, buffer: []u8) !usize {
        var encoder = Encoder{ .buffer = buffer };
        try encoder.encode(T, value);
        return encoder.pos;
    }

    /// 解码
    pub fn decode(comptime T: type, bytes: []const u8) !struct { value: T, read: usize } {
        var decoder = Decoder{ .bytes = bytes };
        const value = try decoder.decode(T);
        return .{ .value = value, .read = decoder.pos };
    }

    /// 计算编码大小
    pub fn encodedSize(comptime T: type, value: T) usize {
        // ...
    }
};
```

## 5. 存储模型

### 5.1 存储键哈希

Substrate 存储使用定长键 (通常 32 字节)。Titan 自动对用户键进行哈希：

```zig
/// 存储适配器
pub const Storage = struct {
    /// 设置存储值
    pub fn set(comptime T: type, key: []const u8, value: T) !void {
        // 1. 哈希键 (Blake2b256)
        var hashed_key: [32]u8 = undefined;
        std.crypto.hash.blake2.Blake2b256.hash(key, &hashed_key, .{});

        // 2. SCALE 编码值
        var buffer: [MAX_VALUE_SIZE]u8 = undefined;
        const encoded_len = try scale.encode(T, value, &buffer);

        // 3. 调用 Seal API
        _ = seal_set_storage(
            @intFromPtr(&hashed_key),
            32,
            @intFromPtr(&buffer),
            @intCast(encoded_len),
        );
    }

    /// 获取存储值
    pub fn get(comptime T: type, key: []const u8) ?T {
        // 1. 哈希键
        var hashed_key: [32]u8 = undefined;
        std.crypto.hash.blake2.Blake2b256.hash(key, &hashed_key, .{});

        // 2. 读取原始字节
        var buffer: [MAX_VALUE_SIZE]u8 = undefined;
        var out_len: u32 = MAX_VALUE_SIZE;

        const ret = seal_get_storage(
            @intFromPtr(&hashed_key),
            32,
            @intFromPtr(&buffer),
            @intFromPtr(&out_len),
        );

        if (ret != 0) return null;  // 不存在

        // 3. SCALE 解码
        const result = scale.decode(T, buffer[0..out_len]) catch return null;
        return result.value;
    }

    /// 删除存储
    pub fn remove(key: []const u8) bool {
        var hashed_key: [32]u8 = undefined;
        std.crypto.hash.blake2.Blake2b256.hash(key, &hashed_key, .{});

        const existed = seal_clear_storage(@intFromPtr(&hashed_key), 32);
        return existed != 0;
    }
};
```

### 5.2 Lazy 存储 (惰性加载)

对于大型数据结构，ink! 使用 Lazy 模式避免不必要的加载：

```zig
/// 惰性存储包装器
pub fn Lazy(comptime T: type) type {
    return struct {
        key: []const u8,
        cached: ?T = null,

        pub fn get(self: *@This()) ?T {
            if (self.cached) |v| return v;
            self.cached = Storage.get(T, self.key);
            return self.cached;
        }

        pub fn set(self: *@This(), value: T) !void {
            self.cached = value;
            try Storage.set(T, self.key, value);
        }
    };
}
```

### 5.3 Mapping 存储

```zig
/// 映射存储 (类似 Solidity mapping)
pub fn Mapping(comptime K: type, comptime V: type) type {
    return struct {
        prefix: []const u8,

        pub fn get(self: @This(), key: K) ?V {
            const full_key = self.makeKey(key);
            return Storage.get(V, full_key);
        }

        pub fn set(self: @This(), key: K, value: V) !void {
            const full_key = self.makeKey(key);
            try Storage.set(V, full_key, value);
        }

        fn makeKey(self: @This(), key: K) []const u8 {
            // prefix + SCALE(key)
            var buf: [256]u8 = undefined;
            @memcpy(buf[0..self.prefix.len], self.prefix);
            const key_len = scale.encode(K, key, buf[self.prefix.len..]) catch 0;
            return buf[0 .. self.prefix.len + key_len];
        }
    };
}
```

## 6. 上下文 (Context)

```zig
pub const Context = struct {
    /// 获取调用者地址
    pub fn caller() AccountId {
        var buf: [32]u8 = undefined;
        var len: u32 = 32;
        seal_caller(@intFromPtr(&buf), @intFromPtr(&len));
        return AccountId.fromBytes(buf[0..len]);
    }

    /// 获取合约地址
    pub fn address() AccountId {
        var buf: [32]u8 = undefined;
        var len: u32 = 32;
        seal_address(@intFromPtr(&buf), @intFromPtr(&len));
        return AccountId.fromBytes(buf[0..len]);
    }

    /// 获取合约余额
    pub fn balance() u128 {
        var buf: [16]u8 = undefined;
        var len: u32 = 16;
        seal_balance(@intFromPtr(&buf), @intFromPtr(&len));
        return std.mem.readIntLittle(u128, buf[0..16]);
    }

    /// 获取转入的金额
    pub fn transferredValue() u128 {
        var buf: [16]u8 = undefined;
        var len: u32 = 16;
        seal_value_transferred(@intFromPtr(&buf), @intFromPtr(&len));
        return std.mem.readIntLittle(u128, buf[0..16]);
    }

    /// 获取当前区块号
    pub fn blockNumber() u32 {
        var buf: [4]u8 = undefined;
        var len: u32 = 4;
        seal_block_number(@intFromPtr(&buf), @intFromPtr(&len));
        return std.mem.readIntLittle(u32, &buf);
    }

    /// 获取当前时间戳 (毫秒)
    pub fn now() u64 {
        var buf: [8]u8 = undefined;
        var len: u32 = 8;
        seal_now(@intFromPtr(&buf), @intFromPtr(&len));
        return std.mem.readIntLittle(u64, &buf);
    }
};
```

## 7. 跨合约调用

### 7.1 调用其他合约

```zig
pub const CallBuilder = struct {
    callee: AccountId,
    gas_limit: u64 = 0,  // 0 = 转发所有剩余 gas
    value: u128 = 0,
    input: []const u8 = &.{},

    pub fn call(self: @This()) ![]const u8 {
        var output: [MAX_OUTPUT_SIZE]u8 = undefined;
        var output_len: u32 = MAX_OUTPUT_SIZE;

        const ret = seal_call(
            0,  // flags
            @intFromPtr(&self.callee.bytes),
            self.gas_limit,
            @intFromPtr(&std.mem.toBytes(self.value)),
            @intFromPtr(self.input.ptr),
            @intCast(self.input.len),
            @intFromPtr(&output),
            @intFromPtr(&output_len),
        );

        if (ret != 0) return error.CallFailed;
        return output[0..output_len];
    }
};

// 使用示例
pub fn callOtherContract(target: AccountId, method: [4]u8, args: anytype) ![]const u8 {
    var input_buf: [1024]u8 = undefined;
    @memcpy(input_buf[0..4], &method);
    const args_len = try scale.encode(@TypeOf(args), args, input_buf[4..]);

    return CallBuilder{
        .callee = target,
        .input = input_buf[0 .. 4 + args_len],
    }.call();
}
```

### 7.2 部署新合约

```zig
pub fn instantiateContract(
    code_hash: [32]u8,
    salt: []const u8,
    value: u128,
    constructor_selector: [4]u8,
    args: anytype,
) !AccountId {
    var input_buf: [1024]u8 = undefined;
    @memcpy(input_buf[0..4], &constructor_selector);
    const args_len = try scale.encode(@TypeOf(args), args, input_buf[4..]);

    var address: [32]u8 = undefined;
    var address_len: u32 = 32;
    var output: [256]u8 = undefined;
    var output_len: u32 = 256;

    const ret = seal_instantiate(
        @intFromPtr(&code_hash),
        0,  // gas (0 = all remaining)
        @intFromPtr(&std.mem.toBytes(value)),
        @intFromPtr(&input_buf),
        @intCast(4 + args_len),
        @intFromPtr(&address),
        @intFromPtr(&address_len),
        @intFromPtr(&output),
        @intFromPtr(&output_len),
        @intFromPtr(salt.ptr),
        @intCast(salt.len),
    );

    if (ret != 0) return error.InstantiateFailed;
    return AccountId.fromBytes(address[0..address_len]);
}
```

## 8. 事件 (Events)

```zig
pub const Event = struct {
    /// 发射事件
    pub fn emit(
        comptime topics: []const type,
        topic_values: anytype,
        data: anytype,
    ) void {
        // 1. 编码 topics
        var topics_buf: [4 * 32]u8 = undefined;
        var topics_len: usize = 0;

        inline for (topics, 0..) |T, i| {
            const topic_bytes = scale.encode(T, topic_values[i], topics_buf[topics_len..]) catch continue;
            topics_len += topic_bytes;
        }

        // 2. 编码 data
        var data_buf: [1024]u8 = undefined;
        const data_len = scale.encode(@TypeOf(data), data, &data_buf) catch 0;

        // 3. 发射
        seal_deposit_event(
            @intFromPtr(&topics_buf),
            @intCast(topics_len),
            @intFromPtr(&data_buf),
            @intCast(data_len),
        );
    }
};

// 使用示例
pub const TransferEvent = struct {
    from: AccountId,
    to: AccountId,
    value: u128,
};

fn emitTransfer(from: AccountId, to: AccountId, value: u128) void {
    // Topic 0: Event signature hash
    const sig_hash = std.crypto.hash.blake2.Blake2b256.hash("Transfer(AccountId,AccountId,u128)");

    Event.emit(
        &[_]type{ [32]u8, AccountId, AccountId },
        .{ sig_hash, from, to },
        TransferEvent{ .from = from, .to = to, .value = value },
    );
}
```

## 9. 完整示例: PSP22 Token (ERC20 等价)

```zig
const titan = @import("titan");
const Context = titan.substrate.Context;
const Storage = titan.substrate.Storage;
const Mapping = titan.substrate.Mapping;
const scale = titan.serde.scale;
const AccountId = titan.substrate.AccountId;

// ===== 存储布局 =====

const balances = Mapping(AccountId, u128){ .prefix = "bal:" };
const allowances = Mapping(struct { AccountId, AccountId }, u128){ .prefix = "alw:" };
var total_supply: u128 = 0;

// ===== 选择器 =====

const SEL_NEW = selector("new");
const SEL_TOTAL_SUPPLY = selector("PSP22::total_supply");
const SEL_BALANCE_OF = selector("PSP22::balance_of");
const SEL_TRANSFER = selector("PSP22::transfer");
const SEL_APPROVE = selector("PSP22::approve");
const SEL_ALLOWANCE = selector("PSP22::allowance");
const SEL_TRANSFER_FROM = selector("PSP22::transfer_from");

// ===== 路由 =====

fn dispatchConstructor(sel: [4]u8, args: []const u8) ![]const u8 {
    if (std.mem.eql(u8, &sel, &SEL_NEW)) {
        const decoded = try scale.decode(struct { initial_supply: u128 }, args);
        try Contract.new(decoded.value.initial_supply);
        return &[_]u8{};
    }
    return error.UnknownConstructor;
}

fn dispatchMessage(sel: [4]u8, args: []const u8) ![]const u8 {
    if (std.mem.eql(u8, &sel, &SEL_TOTAL_SUPPLY)) {
        const result = Contract.total_supply();
        var buf: [16]u8 = undefined;
        _ = try scale.encode(u128, result, &buf);
        return &buf;
    }

    if (std.mem.eql(u8, &sel, &SEL_BALANCE_OF)) {
        const decoded = try scale.decode(struct { owner: AccountId }, args);
        const result = Contract.balance_of(decoded.value.owner);
        var buf: [16]u8 = undefined;
        _ = try scale.encode(u128, result, &buf);
        return &buf;
    }

    if (std.mem.eql(u8, &sel, &SEL_TRANSFER)) {
        const decoded = try scale.decode(struct { to: AccountId, value: u128 }, args);
        try Contract.transfer(decoded.value.to, decoded.value.value);
        return &[_]u8{};
    }

    // ... 其他方法

    return error.UnknownMessage;
}

// ===== 合约实现 =====

pub const Contract = struct {
    pub fn new(initial_supply: u128) !void {
        const caller = Context.caller();
        try balances.set(caller, initial_supply);
        total_supply = initial_supply;

        // 发射 Transfer 事件 (from = zero address)
        emitTransfer(AccountId.zero(), caller, initial_supply);
    }

    pub fn total_supply() u128 {
        return total_supply;
    }

    pub fn balance_of(owner: AccountId) u128 {
        return balances.get(owner) orelse 0;
    }

    pub fn transfer(to: AccountId, value: u128) !void {
        const caller = Context.caller();
        try transferImpl(caller, to, value);
    }

    pub fn approve(spender: AccountId, value: u128) !void {
        const caller = Context.caller();
        try allowances.set(.{ caller, spender }, value);
        emitApproval(caller, spender, value);
    }

    pub fn allowance(owner: AccountId, spender: AccountId) u128 {
        return allowances.get(.{ owner, spender }) orelse 0;
    }

    pub fn transfer_from(from: AccountId, to: AccountId, value: u128) !void {
        const caller = Context.caller();
        const current_allowance = allowance(from, caller);

        if (current_allowance < value) return error.InsufficientAllowance;

        try allowances.set(.{ from, caller }, current_allowance - value);
        try transferImpl(from, to, value);
    }

    fn transferImpl(from: AccountId, to: AccountId, value: u128) !void {
        const from_balance = balances.get(from) orelse 0;
        if (from_balance < value) return error.InsufficientBalance;

        try balances.set(from, from_balance - value);

        const to_balance = balances.get(to) orelse 0;
        try balances.set(to, to_balance + value);

        emitTransfer(from, to, value);
    }
};
```

## 10. 构建配置

### 10.1 编译目标

```bash
# 编译为 Substrate Contracts Wasm
zig build -Dtarget_chain=substrate

# 输出: zig-out/lib/contract.wasm
```

### 10.2 Wasm 后处理

```bash
# 使用 cargo-contract 打包元数据
cargo contract build --manifest-path Cargo.toml

# 或者手动优化
wasm-opt -O3 contract.wasm -o contract.opt.wasm

# 生成 metadata.json (需要单独工具)
titan metadata generate -o metadata.json
```

### 10.3 元数据格式

Substrate 合约需要 metadata.json 描述 ABI：

```json
{
  "source": { "hash": "0x...", "language": "zig", "compiler": "titan" },
  "contract": { "name": "my_token", "version": "0.1.0" },
  "spec": {
    "constructors": [
      {
        "label": "new",
        "selector": "0x...",
        "args": [{ "label": "initial_supply", "type": { "type": 0 } }]
      }
    ],
    "messages": [
      {
        "label": "PSP22::transfer",
        "selector": "0x...",
        "mutates": true,
        "args": [...]
      }
    ]
  },
  "types": [...]
}
```

## 11. 与其他适配器的差异

| 方面 | Polkadot/Ink! | CosmWasm | Near |
| :--- | :--- | :--- | :--- |
| **入口点** | `deploy` / `call` | `instantiate` / `execute` / `query` | 多导出函数 |
| **序列化** | SCALE | JSON | JSON/Borsh |
| **存储键** | 32 字节哈希 | 任意字节 | 任意字节 |
| **跨链** | XCMP/XCM | IBC | 桥接 |
| **方法路由** | 4 字节 Selector | JSON 字段 | 函数名 |

## 12. 链扩展 (Chain Extensions)

Substrate 允许通过 Chain Extensions 暴露自定义功能：

```zig
/// 调用链扩展
extern "seal0" fn seal_call_chain_extension(
    id: u32,
    input_ptr: u32,
    input_len: u32,
    output_ptr: u32,
    output_len_ptr: u32,
) u32;

/// 示例: 调用自定义随机数扩展
pub fn customRandom(seed: []const u8) ![32]u8 {
    var output: [32]u8 = undefined;
    var output_len: u32 = 32;

    const ret = seal_call_chain_extension(
        1001,  // Extension ID
        @intFromPtr(seed.ptr),
        @intCast(seed.len),
        @intFromPtr(&output),
        @intFromPtr(&output_len),
    );

    if (ret != 0) return error.ChainExtensionFailed;
    return output;
}
```

## 13. 限制与边界

1. **Wasm 限制**: 无浮点、无 SIMD、有限栈空间
2. **存储成本**: 存储押金模式，大数据结构代价高
3. **无迭代**: 哈希键无法遍历 (与 CosmWasm 不同)
4. **Gas 模型**: Weight 系统，需要基准测试

## 14. 结论

Polkadot/Substrate 适配器将 Titan 的统一 API 映射到 Substrate Contracts Pallet。通过这层抽象，开发者可以用相同的 Zig 代码部署到 Astar、Moonbeam、Phala 等 Polkadot 生态的智能合约平台，以及其他使用 Substrate 的独立链。
