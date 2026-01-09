# 规范 015: EVM 适配器规范 (EVM Adapter - Stylus)

> 状态: 规划中 (V2/V3 Target)
> 核心策略: 不编译为 EVM Bytecode，而是通过 **Arbitrum Stylus** 运行 Wasm。

**设计原则**: 将 EVM ABI 与调用模型映射为统一资源/IO 语义。

## 1. 架构映射 (Architecture Mapping)

我们不尝试将 Zig 编译为传统的 EVM 字节码（因为架构差异太大）。相反，我们利用 Arbitrum 的 **Stylus** 技术，它允许 EVM 节点直接执行 Wasm。

*   **Titan**: 编译为 `wasm32-unknown-unknown`。
*   **Stylus**: 作为宿主环境，提供 EVM 互操作接口。

## 2. 宿主函数映射 (Host Functions)

Stylus 提供了一组 C 风格的宿主函数，Titan 驱动层需进行封装。

```zig
// drivers/evm/stylus.zig

extern "C" fn storage_load_bytes32(key: *const [32]u8, dest: *[32]u8) void;
extern "C" fn storage_store_bytes32(key: *const [32]u8, value: *const [32]u8) void;
extern "C" fn msg_sender(dest: *Address) void;
```

## 3. 存储模型适配 (Storage Adapter)

EVM 的存储是 `u256 -> u256` 的槽位映射。

*   **Titan 适配**: `titan.storage.set(key, val)`
    *   如果 `val` <= 32 字节: 直接存入槽位。
    *   如果 `val` > 32 字节: 需要实现分片存储逻辑（类似 Solidity 的 Array 布局）。

## 4. ABI 适配

Stylus 合约通常使用 Solidity ABI 进行交互。

*   **入口点**: 导出一个 `user_entrypoint` 函数。
*   **参数解析**: Titan 标准库需提供 `titan.abi.decode`，支持将 Solidity ABI 编码的字节流解析为 Zig 结构体。

## 5. 限制
*   仅支持 Arbitrum One / Nova 及其他支持 Stylus 的链。
*   不支持以太坊主网 (L1) 原生执行（除非 L1 未来支持 Ewasm）。
