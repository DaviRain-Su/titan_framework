# 设计 007: IDL 与客户端生成 (IDL & Client Generation)

> 状态: **已生效 (Effective/Converged)**

**设计原则**: IDL 描述资源/IO 边界，保证多链交互语义一致。

## 1. 概述 (Overview)

为了让前端（TypeScript/React）或后端（Rust/Go）能与 Titan 合约交互，我们需要一种标准的方式来描述合约接口。我们称之为 **Titan IDL**。

## 2. Titan IDL 规范

Titan IDL 是一个 JSON 文件，类似于 Solana 的 Anchor IDL，但更通用。

```json
{
  "version": "0.1.0",
  "name": "my_defi",
  "instructions": [
    {
      "name": "transfer",
      "args": [
        { "name": "to", "type": "pubkey" },
        { "name": "amount", "type": "u64" }
      ],
      "accounts": [
        { "name": "signer", "isMut": true, "isSigner": true }
      ]
    }
  ],
  "types": [ ... ],
  "events": [ ... ]
}
```

## 3. 自动生成机制 (Auto-Generation)

### 3.1 强制结构化参数 (Struct-Based Args)
为了解决 Zig `@typeInfo` 无法稳定获取函数参数名的问题，Titan 强制要求所有公开指令（Instruction）必须接受单一的结构体参数。

```zig
const TransferArgs = struct {
    to: Address,
    amount: u64,
};

pub fn transfer(ctx: Context, args: TransferArgs) !void { ... }
```

构建系统通过反射 `TransferArgs` 的字段名（`to`, `amount`）来生成 IDL 中的 `args` 列表。

### 3.2 元数据注解 (Metadata Annotations)
Zig 没有类似 Rust `#[derive]` 的属性宏。我们使用 **Comptime Mixin** 模式。

用户需要在模块顶部声明一个 IDL 元数据常量：

```zig
pub const titan_idl_meta = .{
    .instructions = .{
        .{ .name = "transfer", .docs = "Transfers tokens", .impl = transfer },
    },
    .accounts = .{
        .{ .name = "MyState", .type = MyState },
    }
};
```

> **注意**: 避免使用双下划线前缀 (`__`)，因为这在许多语言中被视为编译器/运行时保留符号。

这种方式虽然比 Rust 宏繁琐一点，但它是纯 Zig 的，且类型安全。构建脚本会扫描 `root.zig` 中的 `titan_idl_meta` 常量并导出 JSON。

## 4. 多语言客户端生成 (SDK Generation)

基于 IDL，`titan` CLI 可以生成各语言的强类型客户端。

### 4.1 TypeScript (用于 React 前端)

```bash
titan gen-client --lang ts --idl ./target/idl.json --out ./web/src/titan-sdk
```

生成的代码：
```typescript
// 自动生成的类型安全客户端
export class MyDefiClient {
    async transfer(args: { to: PublicKey, amount: BN }): Promise<string> {
        // 自动适配 Solana 的 Transaction 或 Near 的 FunctionCall
        return this.provider.send(...)
    }
}
```

### 4.2 Rust (用于后端/跨合约)

生成 Rust Crate，供其他 Rust 合约或 bot 调用。

## 5. 统一交互层 (Unified Interaction Layer)

客户端库将封装底层的差异：
*   **Solana**: 构建 `Transaction`，添加 `Instruction`，签名发送。
*   **Near**: 构建 `Action`，签名发送。

对前端开发者来说，调用 `transfer` 就是调用一个异步函数，无需关心底层是 Solana 还是 Near。
