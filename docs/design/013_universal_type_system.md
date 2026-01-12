# 设计 013: 通用类型系统 (Universal Type System)

> 状态: 规划中 (V2/V3 Target)
> 核心目标: **Write Once, Compile to Anything**
> 关键技术: Zig `comptime` 多态 + 链感知类型抽象

## 1. 问题陈述

### 1.1 核心矛盾

不同区块链虚拟机的原生数据类型差异巨大：

| 平台 | 原生字长 | 原生整数 | 内存模型 |
| :--- | :--- | :--- | :--- |
| **Solana (SBF)** | 64-bit | `u64`, `i64` | 线性内存 |
| **Near/Polkadot (Wasm)** | 32-bit | `u32`, `i32`, `u64` | 线性内存 |
| **EVM** | 256-bit | `u256` | 栈 + 内存 + 存储 |
| **TON (TVM)** | 257-bit | `int257` | Cell Tree |

**后果**：
- 在 EVM 上处理 `u64` 需要额外的掩码操作（浪费 Gas）
- 在 Solana 上模拟 `u256` 需要软件库（性能损失）
- 直接使用 Zig 原生类型会导致代码无法跨链编译

### 1.2 目标

让开发者写出**一份代码**，通过改变编译目标，自动适配各链的最优类型实现：

```bash
# 同一份代码
zig build -Dtarget_chain=solana    # 使用 u64 原生运算
zig build -Dtarget_chain=evm       # 使用 u256 原生运算
```

## 2. 解决方案：链感知类型系统

### 2.1 核心思想

> **类型是编译时多态的，而非运行时多态。**

利用 Zig 的 `comptime` 能力，在编译时根据 `target_chain` 选择最优的底层实现。**零运行时开销**。

### 2.2 架构总览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       用户业务代码                                       │
│                                                                         │
│   const balance: titan.Int = titan.Int.from(1000);                     │
│   const result = balance.add(amount);                                   │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                    Titan Universal Type Layer                            │
│                                                                         │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│   │  titan.Int  │  │ titan.Uint  │  │ titan.Fixed │  │ titan.Bytes │  │
│   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  │
│          │                │                │                │          │
│          └────────────────┴────────────────┴────────────────┘          │
│                                    │                                    │
│                            comptime switch                              │
│                                    │                                    │
├────────────┬───────────────────────┼───────────────────────┬────────────┤
│  Solana    │         Wasm          │          EVM          │    TON     │
│  Backend   │        Backend        │        Backend        │  Backend   │
├────────────┼───────────────────────┼───────────────────────┼────────────┤
│   u64      │         u64           │         u256          │   int257   │
│   i64      │         i64           │         i256          │   int257   │
│  [32]u8    │        [32]u8         │        bytes32        │    Cell    │
└────────────┴───────────────────────┴───────────────────────┴────────────┘
```

## 3. 核心类型定义

### 3.1 ChainInt - 链感知整数

```zig
// src/types/int.zig

const std = @import("std");
const build_options = @import("build_options");

/// 链感知的无符号整数类型
/// 在不同链上自动选择最优底层表示
pub const Uint = struct {
    /// 底层存储类型 - 编译时确定
    const Storage = switch (build_options.target_chain) {
        .solana, .near, .substrate, .cosmwasm => u128,
        .evm, .stylus => u256,
        .ton => u256,  // TVM 使用 257-bit，我们用 256 近似
        .mock => u128, // 测试时使用 128-bit
        else => u128,
    };

    /// 内部值
    value: Storage,

    // ===== 构造函数 =====

    /// 从编译时已知的值创建
    pub fn from(comptime val: comptime_int) Uint {
        return .{ .value = val };
    }

    /// 从运行时 u64 创建
    pub fn fromU64(val: u64) Uint {
        return .{ .value = @as(Storage, val) };
    }

    /// 从字节数组创建 (大端序)
    pub fn fromBytes(bytes: []const u8) Uint {
        var result: Storage = 0;
        for (bytes) |b| {
            result = (result << 8) | @as(Storage, b);
        }
        return .{ .value = result };
    }

    // ===== 算术运算 =====

    /// 安全加法 (溢出时返回错误)
    pub fn add(self: Uint, other: Uint) !Uint {
        const result = @addWithOverflow(self.value, other.value);
        if (result[1] != 0) return error.Overflow;
        return .{ .value = result[0] };
    }

    /// 安全减法 (下溢时返回错误)
    pub fn sub(self: Uint, other: Uint) !Uint {
        const result = @subWithOverflow(self.value, other.value);
        if (result[1] != 0) return error.Underflow;
        return .{ .value = result[0] };
    }

    /// 安全乘法
    pub fn mul(self: Uint, other: Uint) !Uint {
        const result = @mulWithOverflow(self.value, other.value);
        if (result[1] != 0) return error.Overflow;
        return .{ .value = result[0] };
    }

    /// 安全除法
    pub fn div(self: Uint, other: Uint) !Uint {
        if (other.value == 0) return error.DivisionByZero;
        return .{ .value = self.value / other.value };
    }

    /// 取余
    pub fn mod(self: Uint, other: Uint) !Uint {
        if (other.value == 0) return error.DivisionByZero;
        return .{ .value = self.value % other.value };
    }

    // ===== 饱和运算 (不报错，返回边界值) =====

    pub fn saturatingAdd(self: Uint, other: Uint) Uint {
        const result = @addWithOverflow(self.value, other.value);
        if (result[1] != 0) return .{ .value = std.math.maxInt(Storage) };
        return .{ .value = result[0] };
    }

    pub fn saturatingSub(self: Uint, other: Uint) Uint {
        const result = @subWithOverflow(self.value, other.value);
        if (result[1] != 0) return .{ .value = 0 };
        return .{ .value = result[0] };
    }

    // ===== Wrapping 运算 (溢出时回绕) =====

    pub fn wrappingAdd(self: Uint, other: Uint) Uint {
        return .{ .value = self.value +% other.value };
    }

    pub fn wrappingSub(self: Uint, other: Uint) Uint {
        return .{ .value = self.value -% other.value };
    }

    // ===== 比较运算 =====

    pub fn eq(self: Uint, other: Uint) bool {
        return self.value == other.value;
    }

    pub fn lt(self: Uint, other: Uint) bool {
        return self.value < other.value;
    }

    pub fn gt(self: Uint, other: Uint) bool {
        return self.value > other.value;
    }

    pub fn lte(self: Uint, other: Uint) bool {
        return self.value <= other.value;
    }

    pub fn gte(self: Uint, other: Uint) bool {
        return self.value >= other.value;
    }

    // ===== 位运算 =====

    pub fn bitAnd(self: Uint, other: Uint) Uint {
        return .{ .value = self.value & other.value };
    }

    pub fn bitOr(self: Uint, other: Uint) Uint {
        return .{ .value = self.value | other.value };
    }

    pub fn bitXor(self: Uint, other: Uint) Uint {
        return .{ .value = self.value ^ other.value };
    }

    pub fn shl(self: Uint, bits: u8) Uint {
        return .{ .value = self.value << @intCast(bits) };
    }

    pub fn shr(self: Uint, bits: u8) Uint {
        return .{ .value = self.value >> @intCast(bits) };
    }

    // ===== 转换 =====

    /// 转换为 u64 (可能截断)
    pub fn toU64(self: Uint) u64 {
        return @truncate(self.value);
    }

    /// 安全转换为 u64 (超出范围返回错误)
    pub fn tryToU64(self: Uint) !u64 {
        if (self.value > std.math.maxInt(u64)) return error.Overflow;
        return @truncate(self.value);
    }

    /// 转换为字节数组 (大端序)
    pub fn toBytes(self: Uint) [32]u8 {
        var result: [32]u8 = undefined;
        var val = self.value;
        var i: usize = 32;
        while (i > 0) {
            i -= 1;
            result[i] = @truncate(val);
            val >>= 8;
        }
        return result;
    }

    // ===== 常量 =====

    pub const ZERO = Uint{ .value = 0 };
    pub const ONE = Uint{ .value = 1 };
    pub const MAX = Uint{ .value = std.math.maxInt(Storage) };
};

/// 链感知的有符号整数类型
pub const Int = struct {
    const Storage = switch (build_options.target_chain) {
        .solana, .near, .substrate, .cosmwasm => i128,
        .evm, .stylus => i256,
        .ton => i256,
        .mock => i128,
        else => i128,
    };

    value: Storage,

    // ... 类似 Uint 的实现 ...
};
```

### 3.2 ChainFixed - 定点数

DeFi 应用中常用的定点数类型：

```zig
// src/types/fixed.zig

const Uint = @import("int.zig").Uint;

/// 18 位小数精度的定点数 (类似 Solidity 的 ether)
pub const Wad = struct {
    /// 1 WAD = 10^18
    pub const DECIMALS: u8 = 18;
    pub const SCALE: Uint = Uint.from(1_000_000_000_000_000_000);

    raw: Uint,

    /// 从整数部分创建
    pub fn fromWhole(whole: u64) Wad {
        return .{ .raw = Uint.fromU64(whole).mul(SCALE) catch unreachable };
    }

    /// 从原始值创建
    pub fn fromRaw(raw: Uint) Wad {
        return .{ .raw = raw };
    }

    /// 加法
    pub fn add(self: Wad, other: Wad) !Wad {
        return .{ .raw = try self.raw.add(other.raw) };
    }

    /// 减法
    pub fn sub(self: Wad, other: Wad) !Wad {
        return .{ .raw = try self.raw.sub(other.raw) };
    }

    /// 乘法 (结果需要除以 SCALE)
    pub fn mul(self: Wad, other: Wad) !Wad {
        const product = try self.raw.mul(other.raw);
        return .{ .raw = try product.div(SCALE) };
    }

    /// 除法 (被除数需要乘以 SCALE)
    pub fn div(self: Wad, other: Wad) !Wad {
        const scaled = try self.raw.mul(SCALE);
        return .{ .raw = try scaled.div(other.raw) };
    }

    /// 转换为整数部分
    pub fn toWhole(self: Wad) u64 {
        return self.raw.div(SCALE) catch unreachable;
    }
};

/// 27 位小数精度的定点数 (类似 MakerDAO 的 Ray)
pub const Ray = struct {
    pub const DECIMALS: u8 = 27;
    pub const SCALE: Uint = Uint.from(1_000_000_000_000_000_000_000_000_000);

    raw: Uint,

    // ... 类似 Wad 的实现 ...
};
```

### 3.3 ChainAddress - 链感知地址

```zig
// src/types/address.zig

const build_options = @import("build_options");

/// 链感知的地址类型
pub const Address = struct {
    /// 底层存储 - 统一为 32 字节
    bytes: [32]u8,

    /// 地址长度 - 编译时确定
    pub const LENGTH: usize = switch (build_options.target_chain) {
        .solana => 32,        // Pubkey
        .near => 64,          // AccountId (变长，最大 64)
        .evm, .stylus => 20,  // EVM Address
        .substrate => 32,     // AccountId32
        .cosmwasm => 32,      // Bech32 解码后
        .ton => 32,           // MsgAddressInt
        else => 32,
    };

    /// 从字节创建
    pub fn fromBytes(bytes: []const u8) !Address {
        if (bytes.len > 32) return error.AddressTooLong;
        var result = Address{ .bytes = [_]u8{0} ** 32 };
        @memcpy(result.bytes[0..bytes.len], bytes);
        return result;
    }

    /// 获取有效字节
    pub fn toBytes(self: *const Address) []const u8 {
        return self.bytes[0..LENGTH];
    }

    /// 转换为十六进制字符串
    pub fn toHex(self: *const Address) [LENGTH * 2]u8 {
        const hex_chars = "0123456789abcdef";
        var result: [LENGTH * 2]u8 = undefined;
        for (self.bytes[0..LENGTH], 0..) |byte, i| {
            result[i * 2] = hex_chars[byte >> 4];
            result[i * 2 + 1] = hex_chars[byte & 0x0F];
        }
        return result;
    }

    /// 零地址
    pub const ZERO = Address{ .bytes = [_]u8{0} ** 32 };

    /// 比较
    pub fn eq(self: Address, other: Address) bool {
        return std.mem.eql(u8, &self.bytes, &other.bytes);
    }
};
```

### 3.4 ChainBytes - 动态字节数组

```zig
// src/types/bytes.zig

const build_options = @import("build_options");
const Allocator = @import("allocator.zig").ChainAllocator;

/// 链感知的动态字节数组
pub const Bytes = struct {
    data: []u8,
    allocator: Allocator,

    pub fn init(allocator: Allocator) Bytes {
        return .{ .data = &.{}, .allocator = allocator };
    }

    pub fn fromSlice(allocator: Allocator, slice: []const u8) !Bytes {
        const data = try allocator.alloc(u8, slice.len);
        @memcpy(data, slice);
        return .{ .data = data, .allocator = allocator };
    }

    pub fn deinit(self: *Bytes) void {
        if (self.data.len > 0) {
            self.allocator.free(self.data);
        }
    }

    pub fn append(self: *Bytes, byte: u8) !void {
        const new_data = try self.allocator.realloc(self.data, self.data.len + 1);
        new_data[new_data.len - 1] = byte;
        self.data = new_data;
    }

    pub fn len(self: *const Bytes) usize {
        return self.data.len;
    }
};
```

## 4. 链感知内存分配器

### 4.1 ChainAllocator

```zig
// src/types/allocator.zig

const std = @import("std");
const build_options = @import("build_options");

/// 链感知的内存分配器
/// 根据目标链选择最优的分配策略
pub const ChainAllocator = struct {
    /// 底层分配器实现
    impl: Impl,

    const Impl = switch (build_options.target_chain) {
        .solana => SolanaBumpAllocator,
        .near, .cosmwasm, .substrate => WasmAllocator,
        .evm, .stylus => EvmMemoryAllocator,
        .mock => std.heap.GeneralPurposeAllocator(.{}),
        else => std.heap.GeneralPurposeAllocator(.{}),
    };

    /// 获取标准 Zig Allocator 接口
    pub fn allocator(self: *ChainAllocator) std.mem.Allocator {
        return self.impl.allocator();
    }

    /// 分配内存
    pub fn alloc(self: *ChainAllocator, comptime T: type, n: usize) ![]T {
        return self.allocator().alloc(T, n);
    }

    /// 释放内存
    pub fn free(self: *ChainAllocator, slice: anytype) void {
        self.allocator().free(slice);
    }

    /// 重新分配
    pub fn realloc(self: *ChainAllocator, old: anytype, new_len: usize) !@TypeOf(old) {
        return self.allocator().realloc(old, new_len);
    }
};

/// Solana Bump Allocator
/// 简单的线性分配，不支持释放（适合短生命周期）
const SolanaBumpAllocator = struct {
    /// Solana 堆起始地址
    const HEAP_START: usize = 0x300000000;
    /// Solana 堆大小 (32KB)
    const HEAP_SIZE: usize = 32 * 1024;

    pos: usize = 0,

    fn alloc(self: *SolanaBumpAllocator, len: usize, alignment: u8) ?[*]u8 {
        const aligned_pos = std.mem.alignForward(usize, self.pos, alignment);
        if (aligned_pos + len > HEAP_SIZE) return null;

        const ptr: [*]u8 = @ptrFromInt(HEAP_START + aligned_pos);
        self.pos = aligned_pos + len;
        return ptr;
    }

    fn allocator(self: *SolanaBumpAllocator) std.mem.Allocator {
        return .{
            .ptr = self,
            .vtable = &.{
                .alloc = allocImpl,
                .resize = resizeImpl,
                .free = freeImpl,
            },
        };
    }

    fn allocImpl(ctx: *anyopaque, len: usize, alignment: u8, _: usize) ?[*]u8 {
        const self: *SolanaBumpAllocator = @ptrCast(@alignCast(ctx));
        return self.alloc(len, alignment);
    }

    fn resizeImpl(_: *anyopaque, _: []u8, _: u8, _: usize, _: usize) bool {
        return false; // Bump allocator 不支持 resize
    }

    fn freeImpl(_: *anyopaque, _: []u8, _: u8, _: usize) void {
        // Bump allocator 不支持 free
    }
};

/// Wasm Linear Memory Allocator
const WasmAllocator = struct {
    // 使用 Wasm 的 memory.grow 指令
    // ...
};

/// EVM Memory Allocator
/// 模拟 Solidity 的 Free Memory Pointer 模式
const EvmMemoryAllocator = struct {
    /// Free Memory Pointer 位置 (Solidity 标准: 0x40)
    const FREE_MEM_PTR: usize = 0x40;
    /// 初始空闲内存位置 (Solidity 标准: 0x80)
    const INITIAL_FREE_MEM: usize = 0x80;

    // EVM 内存是无限的（但 Gas 随大小增长）
    // ...
};
```

## 5. 类型映射表

### 5.1 整数类型映射

| Titan 类型 | Solana | Wasm | EVM | TON |
| :--- | :--- | :--- | :--- | :--- |
| `titan.Uint` | `u128` | `u128` | `u256` | `u256` |
| `titan.Int` | `i128` | `i128` | `i256` | `i256` |
| `titan.U64` | `u64` (原生) | `u64` (原生) | `u256` (填充) | `int257` |
| `titan.U256` | `u256` (软件) | `u256` (软件) | `u256` (原生) | `u256` |

### 5.2 地址类型映射

| Titan 类型 | Solana | Near | EVM | Substrate |
| :--- | :--- | :--- | :--- | :--- |
| `titan.Address` | `Pubkey [32]u8` | `AccountId` | `address (20B)` | `AccountId32` |

### 5.3 存储类型映射

| Titan 类型 | Solana | Near | EVM | TON |
| :--- | :--- | :--- | :--- | :--- |
| `titan.storage.set` | Account Data | Trie KV | `sstore` | Cell |
| `titan.storage.get` | Account Data | Trie KV | `sload` | Cell |

## 6. 使用示例

### 6.1 跨链 Token 合约

```zig
// src/token.zig
const titan = @import("titan");

pub const TokenState = struct {
    total_supply: titan.Uint,
    balances: titan.Map(titan.Address, titan.Uint),
    allowances: titan.Map(titan.Address, titan.Map(titan.Address, titan.Uint)),
};

/// 转账 - 同一份代码，编译到任意链
pub fn transfer(
    ctx: *titan.Context,
    to: titan.Address,
    amount: titan.Uint,
) !void {
    var state = try ctx.load(TokenState);
    const sender = ctx.sender();

    // 检查余额
    const sender_balance = state.balances.get(sender) orelse titan.Uint.ZERO;
    if (sender_balance.lt(amount)) {
        return error.InsufficientBalance;
    }

    // 扣除发送者余额
    try state.balances.put(sender, try sender_balance.sub(amount));

    // 增加接收者余额
    const to_balance = state.balances.get(to) orelse titan.Uint.ZERO;
    try state.balances.put(to, try to_balance.add(amount));

    // 保存状态
    try ctx.save(state);

    // 发送事件
    titan.emit(.Transfer, .{
        .from = sender,
        .to = to,
        .amount = amount,
    });
}
```

### 6.2 编译到不同链

```bash
# 编译到 Solana
# titan.Uint -> u128, 原生算术
zig build -Dtarget_chain=solana
# 输出: token.so

# 编译到 Near
# titan.Uint -> u128, Wasm 指令
zig build -Dtarget_chain=near
# 输出: token.wasm

# 编译到 EVM
# titan.Uint -> u256, 转译为 Yul
zig build -Dtarget_chain=evm
# 输出: token.yul -> token.bin

# 编译到 Arbitrum Stylus
# titan.Uint -> u256, Wasm + Stylus Host
zig build -Dtarget_chain=stylus
# 输出: token.wasm
```

## 7. EVM 特殊处理

### 7.1 类型提升

在 EVM 上，所有整数都被提升为 `u256`：

```zig
// 用户代码
const a: titan.Uint = titan.Uint.from(100);
const b: titan.Uint = titan.Uint.from(200);
const c = try a.add(b);

// 编译到 Solana (原生 u128)
// add r0, r1, r2

// 编译到 EVM (转译为 Yul)
// let c := add(a, b)
```

### 7.2 Yul 代码生成

```zig
// src/backends/evm/codegen.zig

/// 将 Titan Uint 操作转译为 Yul
pub fn emitAdd(a: []const u8, b: []const u8) []const u8 {
    return std.fmt.allocPrint(allocator,
        "add({s}, {s})", .{ a, b }) catch unreachable;
}

pub fn emitSub(a: []const u8, b: []const u8) []const u8 {
    return std.fmt.allocPrint(allocator,
        "sub({s}, {s})", .{ a, b }) catch unreachable;
}

pub fn emitMul(a: []const u8, b: []const u8) []const u8 {
    return std.fmt.allocPrint(allocator,
        "mul({s}, {s})", .{ a, b }) catch unreachable;
}

/// 安全除法 (检查除零)
pub fn emitSafeDiv(a: []const u8, b: []const u8) []const u8 {
    return std.fmt.allocPrint(allocator,
        \\if iszero({1s}) {{ revert(0, 0) }}
        \\div({0s}, {1s})
    , .{ a, b }) catch unreachable;
}
```

## 8. 性能考量

### 8.1 零开销抽象

由于使用 `comptime` 选择实现，**运行时没有任何分发开销**：

```zig
// 编译后的 Solana 代码 - 直接使用原生 u128 指令
// 没有虚函数调用、没有类型检查

// 编译后的 EVM 代码 - 直接使用 u256 操作
// 转译为最优的 Yul/EVM 指令
```

### 8.2 各链性能对比

| 操作 | Solana (u128) | Wasm (u128) | EVM (u256) |
| :--- | :--- | :--- | :--- |
| `add` | ~1 CU | ~1 cycle | 3 Gas |
| `mul` | ~1 CU | ~1 cycle | 5 Gas |
| `div` | ~1 CU | ~1 cycle | 5 Gas |
| `u256 add` | ~50 CU (软件) | ~50 cycles | 3 Gas (原生) |

## 9. 与现有设计的关系

| 现有设计 | 关系 |
| :--- | :--- |
| 005_standard_library | **扩展**: 本设计是 `titan.math` 的底层实现 |
| 020_adapter_evm_native | **补充**: 本设计解决类型映射，020 解决编译流程 |
| 022_backend_registry | **依赖**: 后端选择决定类型实现 |

## 10. 实现路线图

### Phase 1: 基础类型
- [ ] 实现 `titan.Uint` / `titan.Int`
- [ ] 实现 `titan.Address`
- [ ] Solana + Mock 后端验证

### Phase 2: 扩展类型
- [ ] 实现 `titan.Fixed` (Wad, Ray)
- [ ] 实现 `titan.Bytes`
- [ ] Wasm 后端验证

### Phase 3: EVM 支持
- [ ] 类型到 Yul 的转译
- [ ] EVM 内存分配器
- [ ] 端到端 EVM 测试

## 11. 结论

Universal Type System 是实现 **"Write Once, Compile to Anything"** 的核心基础设施。

**关键创新**:
1. **comptime 多态**: 编译时选择最优实现，零运行时开销
2. **类型统一**: 开发者使用 `titan.Uint`，无需关心底层是 u64 还是 u256
3. **无缝跨链**: 同一份业务代码，改变编译目标即可部署到任意链

这是 Titan OS 实现"区块链操作系统"愿景的类型系统基石。
