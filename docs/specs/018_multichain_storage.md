# 规范 018: 多链存储适配规范 (Multi-Chain Storage Adapters)

本规范定义了 Titan OS 的 `titan.storage` 接口在 WebAssembly 系区块链（Near, CosmWasm, Polkadot）上的具体实现。

## 1. Near Protocol (NEAR)

Near 使用基于 Trie 的状态树。存储成本是按字节收取原生代币（Storage Staking）。

### 1.1 宿主函数映射
Titan 内核映射到 `near_sys` crate 中的函数：

*   **写**: `storage_write(key_len, key_ptr, val_len, val_ptr, register_id)`
    *   *行为*: 如果 key 已存在，返回 1 并将旧值存入 register；否则返回 0。
    *   *成本*: 必须保证合约账户有足够的 NEAR 余额来支付存储押金。
*   **读**: `storage_read(key_len, key_ptr, register_id)`
    *   *行为*: 如果存在，将值存入 register 并返回 1；否则返回 0。
    *   *数据获取*: 随后调用 `read_register(register_id, buffer_ptr)` 将数据从 VM 拷贝到线性内存。

### 1.2 键前缀 (Key Prefixing)
为了避免键冲突（Key Collision），Titan 建议使用**命名空间前缀**策略，虽然 V1 暂不强制。
*   `set("config")` -> 底层 Key: `"t_config"` (t 代表 titan)

## 2. Cosmos (CosmWasm)

CosmWasm 提供了一个简单的 KV 存储接口，后端通常是 IAVL 树。

### 2.1 宿主函数映射
Titan 内核通过 Wasm Import 调用宿主环境：

*   **写**: `db_write(key_ptr, value_ptr)`
    *   *注意*: CosmWasm 的指针通常包含 Region 结构（offset + length），不仅仅是原始指针。Titan Allocator 需要适配这种 Region 布局。
*   **读**: `db_read(key_ptr)` -> 返回 Region 指针。

### 2.2 迭代器 (Iterators)
CosmWasm 强大之处在于支持 KV 迭代。
*   `db_scan(start_ptr, end_ptr, order)`
*   `db_next(iterator_id)`
*   *Titan V2 规划*: 将暴露 `titan.storage.iter(prefix)` 接口。

## 3. Polkadot (Ink! / Substrate)

Substrate 的存储稍微复杂一些，通常是强类型的。

### 3.1 宿主函数映射 (Seal API)
*   **写**: `seal_set_storage(key_ptr, value_ptr, value_len)`
*   **读**: `seal_get_storage(key_ptr, out_ptr, out_len_ptr)`

### 3.2 键哈希 (Key Hashing)
Substrate 通常要求 Key 是定长的（如 32 字节哈希）。
*   *Titan 适配*: `titan.storage.set("my_key")`
    *   底层: `Blake2b256("my_key")` -> 32 字节 Key -> `seal_set_storage`。
    *   这意味着 Polkadot 上不支持 `scan`（无法遍历哈希后的键）。

## 4. 统一行为保证 (Uniform Behavior)

为了保证跨链一致性，Titan 内核在这些链上必须强制执行以下规则：

1.  **最大键长度**: 统一限制 Key 最长为 256 字节（适配 Polkadot 的哈希前逻辑）。
2.  **最大值长度**: 统一限制 Value 最长为 1MB（适配 Near 的交易限制）。
3.  **原子性**: 所有写操作必须在交易成功结束时才生效（由底层链保证）。

## 5. 结论

通过这层适配，`titan.storage` 在 Wasm 链上的行为将高度一致：都是直接操作底层的 KV 数据库。这比 Solana 的 PDA 模拟要自然得多，性能也更高。
