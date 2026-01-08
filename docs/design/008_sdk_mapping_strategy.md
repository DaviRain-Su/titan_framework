# 设计 008: SDK 映射策略 (SDK Mapping Strategy)

> 状态: 草稿
> 核心问题: 如何用一套 Titan API 覆盖差异巨大的 Solana/Near/Cosmos SDK？

## 1. 核心理念：最大公约数 + 驱动扩展

我们不可能覆盖 100% 的 SDK 功能（比如 Solana 的 Account Rent 机制在 Near 上不存在）。我们的策略是：

1.  **Core (90%)**: 提取所有链共有的逻辑（转账、存储、日志、调用），做成统一 API。
2.  **Drivers (10%)**: 将特定链的逻辑（如 Solana PDA，Near Access Keys）隔离在 `driver` 模块中。

## 2. 内存模型映射 (The Memory Gap)

这是最难的部分。

### 2.1 Solana (直接内存映射)
*   **底层**: 运行时直接将所有账户数据序列化到一段连续的堆内存中。
*   **Titan 适配**: `titan.os.read_input()` 返回一个 Slice，该 Slice 直接指向这块内存。**零拷贝**。

### 2.2 Near (寄存器 IO)
*   **底层**: Near 不把数据放入内存。你必须调用 `read_register(reg_id, ptr)` 把数据从 VM 内部拉取到 Wasm 线性内存。
*   **Titan 适配**:
    *   Titan 内核维护一个内部缓冲区。
    *   当用户调用 `read_input()` 时，内核隐式调用 `read_register` 并拷贝数据。
    *   **有拷贝开销**，但是是为了统一 API 必须付出的代价。

## 3. 存储模型映射 (The Storage Gap)

### 3.1 键值对抽象 (KV Abstraction)
所有链最终都能抽象为 KV 存储。

| 平台 | 写操作底层 API | 读操作底层 API | Titan 统一接口 |
| :--- | :--- | :--- | :--- |
| **Solana** | 修改 `AccountInfo.data` 切片 | 直接读取切片 | `storage.set/get` |
| **Near** | `storage_write(key, val)` | `storage_read(key)` | `storage.set/get` |
| **Cosmos** | `db_write(key, val)` | `db_read(key)` | `storage.set/get` |

### 3.2 复杂性封装 (Solana 特例)
Solana 的"KV"其实是"账户内的数据"。

**V1 策略 (Struct-based Mapping)**:
根据 [规范 000: V1 收敛设计稿](../specs/000_v1_convergence.md)，V1 阶段**放弃通用 KV 模拟**。
*   用户定义一个大结构体 `MyAccountData`，Titan 将其直接序列化到 Account Data 中。
*   不支持动态增长的 `HashMap`，仅支持固定布局或简单的 `ArrayList`（尾部增长）。
*   `storage.get/set` 在 Solana 上映射为对结构体字段的直接访问。

```zig
// V1 推荐写法
const MyState = struct {
    counter: u64,
    owner: [32]u8,
    balances: [100]u64, // 固定大小数组，而非动态 HashMap
};
```

**V2+ 策略 (可选扩展)**:
未来版本可考虑引入简单的 Arena-based ArrayList 或受限的 KV 模拟，但 V1 优先保证简单和性能。

## 4. 跨合约调用映射 (CPI Gap)

### 4.1 统一语义
`titan.call(target, function, args, coins)`

### 4.2 Solana 实现
*   将 `target` 转换为 `AccountMeta`。
*   将 `function` + `args` 序列化为 Instruction Data。
*   调用 `sol_invoke`。

### 4.3 Near 实现
*   将 `target` 视为 Account ID。
*   调用 `promise_batch_create` + `promise_batch_action_function_call`。

## 5. 无法统一的部分 (Driver Layer)

对于无法统一的特性，Titan 不强行抽象，而是通过 `titan.driver` 暴露。

*   **Solana Driver**: 暴露 `Clock` sysvar, `Rent` sysvar。
*   **Near Driver**: 暴露 `Predecessor Account ID`, `Block Index`。

开发者可以使用 `if (titan.config.chain == .solana)` 来编写特定逻辑。
