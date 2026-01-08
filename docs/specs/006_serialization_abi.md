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
