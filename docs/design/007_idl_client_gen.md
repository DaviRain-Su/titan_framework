# 设计 007: IDL 与客户端生成 (IDL & Client Generation)

> 状态: 草稿

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

我们不希望用户手写 JSON。Titan 利用 Zig 强大的反射能力 (`@typeInfo`) 在编译时自动生成 IDL。

### 3.1 编译时反射

```zig
// 在构建阶段运行的一个特殊步骤
pub fn generate_idl() !void {
    const entrypoints = @import("src/main.zig").entrypoints;
    
    // 遍历所有导出函数
    inline for (entrypoints) |func| {
        // 分析参数名和类型
        const args = @typeInfo(@TypeOf(func)).Fn.args;
        // 导出到 JSON
    }
}
```

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
