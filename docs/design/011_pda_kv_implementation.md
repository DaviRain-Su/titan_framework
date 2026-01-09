# 设计 011: 基于 PDA 的虚拟 KV 实现 (Virtual KV via PDA)

> 状态: 规划中 (V1 核心逻辑)
> 目标: 在 Solana 上实现高性能的 `titan.storage` 接口，同时保持与 Wasm 链 (Near) 的语义一致。

## 1. 背景 (Context)

在 Solana 中，程序不能随意创建账户或随机读写内存。所有的状态必须存储在交易（Transaction）中预先声明的账户里。为了让 `storage.set(key, value)` 这种 KV 接口工作，我们需要一套自动化的账户匹配机制。

## 2. 核心流程 (The Lookup Mechanism)

当用户在 Titan OS 中调用 `ctx.storage.get("my_config", buffer)` 时，内核执行以下步骤：

### 2.1 PDA 派生 (Derivation)
内核使用当前 `program_id` 和用户提供的 `key` 作为种子（Seed），计算 PDA 地址。
*   `seed = "my_config"`
*   `address, bump = find_program_address(seeds=[seed], program_id)`

### 2.2 账户定位 (Account Finding)
内核遍历交易传入的 `remaining_accounts` 列表：
```zig
fn find_account(key: []const u8, accounts: []AccountInfo) !*AccountInfo {
    const target_pda = derive_pda(key);
    for (accounts) |*acc| {
        if (std.mem.eql(u8, acc.key, target_pda)) {
            return acc;
        }
    }
    return error.AccountNotFoundInTransaction;
}
```

### 2.3 权限校验 (Validation)
定位到账户后，内核必须进行安全检查：
1.  **所有者检查**: 该账户的 `owner` 必须是当前 `program_id`。
2.  **可写检查**: 如果是 `set` 操作，该账户在交易中必须被标记为 `is_writable`。

## 3. 性能优化策略 (Performance)

遍历账户数组的时间复杂度是 $O(N)$。在 Solana 交易中，$N$ 通常小于 32，因此遍历性能是可以接受的。

**高级优化 (V2)**:
*   **缓存**: 内核在 `Context` 初始化时，预先对所有账户进行哈希映射，使查找达到 $O(1)$。
*   **有序查找**: 规定客户端在发送交易时，按 Key 的字母顺序排列账户，内核使用二分查找。

## 4. 账户初始化 (Initialization / Create)

如果调用 `storage.set("new_key", data)` 时，对应的 PDA 账户还不存在怎么办？

*   **策略**: Titan OS 不支持在合约内隐式创建账户（因为这需要额外的 CPI 调用和签名）。
*   **规范**: 账户的创建必须由**客户端**（如 TypeScript SDK）在发起交易前完成。
*   **SDK 联动**: Titan 客户端工具链会自动检测代码中的 `storage.set` 调用，并在发送交易前，自动在同一笔交易中插入一条 `system_program.create_account` 指令。

## 5. 存储布局 (Data Layout)

PDA 账户的 Data 字段内部布局：
1.  **Header (8 bytes)**: 版本号 + 数据长度。
2.  **Payload**: 实际的 Borsh 序列化数据。

## 6. 与 Near 的对比 (Near Mapping)

| 特性 | Solana 实现 (Titan) | Near 实现 (Native) |
| :--- | :--- | :--- |
| **底层载体** | 独立的 PDA 账户 | 全局状态 Trie 树 |
| **扩容方式** | `realloc` 账户空间 | 自动扩展 (支付 Gas) |
| **索引方式** | 交易账户列表索引 | 宿主函数哈希索引 |

## 7. 结论

通过 PDA 映射，我们在 Solana 上完美模拟了 KV 语义。这种模式不仅符合 Solana 的高性能并发哲学，还成功实现了与异步 Wasm 链的逻辑统一。
