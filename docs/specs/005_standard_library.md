# 规范 005: 标准库 (Standard Library)

本规范定义了 `titan.lib` 的功能范围。Titan 标准库旨在提供**高效、安全且针对区块链优化**的基础工具。

**设计原则**: 标准库以资源/IO 抽象为基础，避免暴露链特定细节。

## 1. 数学库 (`titan.math`)

区块链金融逻辑的核心是数学，特别是大整数运算。

### 1.1 大整数 (BigInt)

虽然 Zig 原生支持 `u256`，但在某些不支持 `u128/u256` 指令集的架构上（如早期 BPF），性能可能不佳。Titan 标准库封装了最优实现。

*   **类型**: `U256`, `I256`, `Wad`, `Ray` (定点数)。
*   **安全运算**: 所有的加减乘除默认进行溢出检查 (`checked_add` 等)。
*   **功能**:
    *   `add`, `sub`, `mul`, `div` (带取余)
    *   `pow` (幂运算)
    *   `sqrt` (开方)

### 1.2 饱和运算 (Saturating Math)

提供 `saturating_add` 等变体，溢出时返回最大值而不是报错，适用于某些游戏逻辑。

## 2. 集合库 (`titan.collections`)

基于 Zig 标准库的封装，但针对短生命周期的交易执行进行了优化。

*   **ArrayList**: 动态数组。
*   **AutoHashMap**: 基于哈希的键值对。
*   **StaticMap**: 编译时确定的映射，零内存分配（适合配置表）。

## 3. 加密原语 (`titan.crypto`)

利用底层链的宿主函数加速加密运算。如果链不支持，则回退到纯 Zig 实现。

*   **哈希**:
    *   `sha256(data: []const u8) [32]u8`
    *   `keccak256(data: []const u8) [32]u8`
    *   `blake3` (如果平台支持)
*   **签名验证**:
    *   `ed25519_verify(sig, msg, pubkey) bool`
    *   `secp256k1_recover`

## 4. 编码与序列化 (`titan.encoding`)

*   **Hex**: 十六进制编解码。
*   **Base64**: Base64 编解码。
*   **Borsh/BSN**: 二进制序列化支持（将在规范 006 详述）。
