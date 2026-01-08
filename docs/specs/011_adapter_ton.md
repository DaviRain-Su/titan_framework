# 规范 011: TON 适配器规范 (TON Adapter)

本规范定义了 Titan OS 如何在底层对接 TON (The Open Network) 运行时。由于 TVM 架构的特殊性（非冯·诺依曼架构），本适配器采用 **源码转译 (Source-to-Source Transpilation)** 策略，而非直接编译为字节码。

## 1. 架构映射策略

| Titan 概念 | TON (TVM/Tact) 概念 | 适配策略 |
| :--- | :--- | :--- |
| **Contract** | **Actor** | 每个 Titan 合约映射为一个 Tact `contract`。 |
| **Message** | **Message (TL-B)** | Zig `struct` 映射为 Tact `message` (自动处理 Cell 打包)。 |
| **Storage** | **Contract Fields** | Titan `storage` 映射为 Tact 合约的成员变量。 |
| **Function** | **Receiver** | Zig `pub fn` 映射为 Tact `receive()`。 |

## 2. 数据结构适配 (The Cell Impedance Mismatch)

### 2.1 结构体映射
Titan 中的 Zig 结构体将被转译为 Tact 的 Struct/Message。

**Zig 源:**
```zig
const Transfer = struct {
    to: Address,
    amount: u64,
    comment: []const u8, // 字符串
};
```

**Tact 目标:**
```typescript
message Transfer {
    to: Address;
    amount: Int as uint64;
    comment: String; // Tact 自动处理 String 到 Cell 的引用链
}
```

### 2.2 序列化 (Borsh vs TL-B)
*   在 Solana/Near 上，我们使用 Borsh。
*   在 TON 上，我们**放弃 Borsh**，直接使用 TON 原生的 TL-B 序列化。
*   **原因**: TVM 对 Cell 操作有原生优化，强行用 Borsh (线性字节流) 会导致 Gas 爆炸且难以调试。

## 3. 存储适配 (Storage Adapter)

TON 没有通用的 KV 存储（像 Near 的 Trie）。它的存储是合约的成员变量（也是 Cell）。

### 3.1 模拟 KV
为了支持 `titan.storage.set("key", val)`，我们需要在 Tact 层面生成一个 `map<Int, Cell>`。

**Tact 生成代码:**
```typescript
contract TitanActor {
    // 模拟通用 KV 存储
    // Sha256(Key) -> Cell
    storage: map<Int, Cell>;

    get fun get_storage(key: Int): Cell? {
        return this.storage.get(key);
    }
}
```

## 4. 异步模型适配 (Async/Actor Model)

### 4.1 发送消息
Titan 的 `titan.call` 将被转译为 Tact 的 `send`。

**Zig 源:**
```zig
titan.call(.{
    .to = target,
    .amount = 100,
    .body = MyMessage { ... }
});
```

**Tact 目标:**
```typescript
send(SendParameters{
    to: target,
    value: 100,
    body: MyMessage{ ... }.toCell()
});
```

## 5. 转译器 CLI 设计 (`roc-ton`)

我们需要开发一个名为 `titan-ton-bridge` 的 CLI 工具。

### 5.1 工作流
1.  **解析**: 使用 `libclang` 或 Zig 自带的 `Ast` 解析 Zig 源码。
2.  **分析**: 提取所有 `pub const` 结构体和 `pub fn` 函数。
3.  **生成**: 使用模板引擎输出 `.tact` 文件。
4.  **编译**: 调用 `tact` 编译器生成 `.boc`。

## 6. 限制与边界 (Limitations)

由于是转译而非原生编译，TON 适配器会有以下限制：
1.  **不支持指针运算**: Zig 中的指针操作无法翻译为 Tact。
2.  **不支持裸内存访问**: `allocator` 在 TON 上是**不可用**的。用户必须使用高级数据结构 (`ArrayList` 等)，这些会被映射为 Tact 的数组。
3.  **标准库受限**: 只有 `titan.lib` 中的子集（如 Math）可用。

## 7. 结论

TON 适配层本质上是一个 **"Zig to Tact Cross-Compiler"**。虽然工程量大，但它是唯一能保留 Zig 语法同时利用 TVM 特性的可行路径。
