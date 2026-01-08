# 规范 006: 序列化与二进制接口 (Serialization & ABI)

本规范定义了 Titan OS 如何处理数据的输入与输出，以及合约之间如何通信。

## 1. 统一数据交换格式 (Titan Binary Format)

为了实现“一次编写，到处运行”，Titan OS 推荐在所有链上优先使用 **Borsh (Binary Object Representation Serializer for Hashing)** 作为默认序列化格式。

**理由**:
*   **确定性**: 相同的对象永远产生相同的字节序列。
*   **紧凑**: 无字段名开销。
*   **零拷贝潜力**: 结构简单，易于解析。

## 2. 接口定义语言 (IDL)

Titan OS 将引入一种轻量级的 IDL 机制（通过 Zig 的 `comptime` 反射自动生成），用于描述合约接口。

```zig
// 用户定义的结构体
const TransferArgs = struct {
    to: Address,
    amount: u64,
};

// 内核自动生成的解析逻辑
pub fn entrypoint(input: []const u8) !void {
    const args = try titan.serde.deserialize(TransferArgs, input);
    // ...
}
```

## 3. 平台适配策略

尽管内部推荐 Borsh，但必须兼容外部世界的调用标准。

### 3.1 Solana (指令数据)
*   **输入**: 字节数组。
*   **解析**: 默认假设为 Borsh 编码。
*   **鉴权**: `Signer` 类型的字段会自动校验 `is_signer` 标志。

### 3.2 Near (JSON vs Borsh)
*   Near 调用通常是 JSON。
*   **适配**: Titan 将提供一个 `titan.serde.json` 模块。如果用户希望支持 JSON 调用，只需切换反序列化器即可。
*   **建议**: 内部跨合约调用使用 Borsh，对外部用户接口使用 JSON（通过宏或构建标志控制）。

### 3.3 EVM (ABI Encoding) - via Stylus
*   Arbitrum Stylus 使用 Solidity ABI。
*   **适配**: Titan 内核将提供 `titan.abi.decode` 和 `titan.abi.encode`，利用 Zig 的元编程能力，自动将 Zig 结构体映射为 ABI 编码。

## 4. 跨合约调用 (CPI)

Titan 提供统一的 `call` 接口：

```zig
const result = try titan.os.call(.{
    .program_id = token_program,
    .function = "transfer",
    .args = TransferArgs { ... },
    .coins = 0, // 附带的原生代币
});
```

*   在 **Solana** 上，这将编译为 `sol_invoke_signed`。
*   在 **Near** 上，这将编译为 `promise_create`。

## 5. V1 Borsh 实现策略 (Critical)

### 5.1 实现方案选择

V1 采用 **自实现最小 Borsh 子集**，理由：

| 方案 | 优点 | 缺点 | 决定 |
| :--- | :--- | :--- | :--- |
| 移植 Rust borsh-rs | 功能完整 | 依赖 Rust FFI，增加复杂度 | ❌ |
| 使用 zig-borsh 社区库 | 快速启动 | 库质量不确定，维护风险 | ❌ |
| **自实现 comptime 版本** | 零依赖，与 Zig 深度集成 | 需要开发投入 | ✓ V1 |

### 5.2 V1 支持的类型子集

```zig
/// V1 Borsh 序列化支持的类型
pub const SupportedTypes = union(enum) {
    // 基础类型
    u8, u16, u32, u64, u128,
    i8, i16, i32, i64, i128,
    bool,

    // 固定长度数组
    array: struct { child: *const SupportedTypes, len: usize },

    // 动态切片 (前缀 u32 长度)
    slice: struct { child: *const SupportedTypes },

    // 结构体 (字段按顺序序列化)
    @"struct": []const StructField,

    // 可选类型 (0x00 = null, 0x01 + data = some)
    optional: *const SupportedTypes,

    // Pubkey (32 字节固定)
    pubkey,
};
```

**V1 不支持**：
- `enum` (union 类型) — V2 扩展
- `HashMap` / `BTreeMap` — 状态存储使用 Struct-based Mapping
- 嵌套 `slice` — 简化实现

### 5.3 核心 API

```zig
pub const serde = struct {
    /// 序列化结构体到字节数组
    /// 返回写入的字节数
    pub fn serialize(comptime T: type, value: T, buffer: []u8) !usize;

    /// 从字节数组反序列化
    /// 返回解析后的值和消耗的字节数
    pub fn deserialize(comptime T: type, bytes: []const u8) !struct { value: T, bytes_read: usize };

    /// 计算序列化后的大小 (用于预分配)
    pub fn serializedSize(comptime T: type, value: T) usize;
};
```

### 5.4 字节序与对齐

| 属性 | 规则 | 说明 |
| :--- | :--- | :--- |
| **字节序** | Little-endian | 与 Solana Runtime 一致 |
| **对齐** | 无填充 (Packed) | 紧凑排列，无对齐填充 |
| **长度前缀** | u32 | 动态切片使用 4 字节长度前缀 |
| **可选前缀** | u8 | 0x00 = None, 0x01 = Some |

### 5.5 状态序列化边界

```
┌─────────────────────────────────────────────────────────────────┐
│                     Account Data Layout                         │
├─────────────────────────────────────────────────────────────────┤
│  Offset 0-7:   Discriminator (8 bytes, hash of struct name)     │
│  Offset 8-N:   Borsh-serialized struct data                     │
└─────────────────────────────────────────────────────────────────┘
```

**Discriminator 计算**:
```zig
/// 生成 8 字节结构体鉴别符
pub fn discriminator(comptime T: type) [8]u8 {
    const name = @typeName(T);
    const hash = std.crypto.hash.sha2.Sha256.hash(name);
    return hash[0..8].*;
}
```

### 5.6 Schema 版本控制 (状态迁移)

V1 使用简单的版本号策略：

```zig
/// 带版本的状态结构体
pub fn Versioned(comptime T: type) type {
    return struct {
        version: u8,        // Schema 版本号
        data: T,            // 实际数据

        pub const CURRENT_VERSION: u8 = 1;

        /// 加载时自动检查版本
        pub fn load(bytes: []const u8) !@This() {
            const result = try serde.deserialize(@This(), bytes);
            if (result.value.version != CURRENT_VERSION) {
                return error.SchemaMismatch;
            }
            return result.value;
        }
    };
}

// 用户使用示例
const MyState = Versioned(struct {
    counter: u64,
    owner: Pubkey,
});
```

**迁移策略**:
- V1: 版本不匹配 → 返回 `error.SchemaMismatch`，由用户处理
- V2: 支持自动迁移函数 `migrate(old_version, old_data) -> new_data`

### 5.7 完整示例

```zig
const std = @import("std");
const titan = @import("titan");

// 定义状态结构体
const CounterState = struct {
    count: u64,
    authority: titan.Pubkey,
    is_initialized: bool,
};

// 从账户数据加载
pub fn load_state(account_data: []const u8) !CounterState {
    // 1. 验证 discriminator
    if (account_data.len < 8) return error.InvalidAccountData;

    const expected_disc = titan.serde.discriminator(CounterState);
    if (!std.mem.eql(u8, account_data[0..8], &expected_disc)) {
        return error.AccountDiscriminatorMismatch;
    }

    // 2. 反序列化数据部分
    const result = try titan.serde.deserialize(CounterState, account_data[8..]);
    return result.value;
}

// 保存到账户数据
pub fn save_state(state: CounterState, account_data: []u8) !void {
    // 1. 写入 discriminator
    const disc = titan.serde.discriminator(CounterState);
    @memcpy(account_data[0..8], &disc);

    // 2. 序列化数据
    _ = try titan.serde.serialize(CounterState, state, account_data[8..]);
}
```
