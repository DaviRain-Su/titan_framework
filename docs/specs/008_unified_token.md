# 规范 008: 统一代币标准 (Unified Token Standard)

本规范定义了 Titan OS 上的“标准代币接口”。它旨在抽象 Solana 的 SPL Token、Ethereum 的 ERC-20 和 Near 的 NEP-141。

## 1. 核心接口 (`titan.token.IToken`)

```zig
pub const IToken = struct {
    /// 转账
    pub fn transfer(ctx: Context, to: Address, amount: u64) !void;

    /// 获取余额
    pub fn balance_of(ctx: Context, owner: Address) !u64;

    /// 获取总供应量
    pub fn total_supply(ctx: Context) !u64;
    
    /// 授权 (Approve) - 仅在支持的链上有效，Solana 可能会被忽略或模拟
    pub fn approve(ctx: Context, spender: Address, amount: u64) !void;
};
```

## 2. 实现映射

当用户调用 `titan.token.transfer` 时，底层发生了什么？

### 2.1 Solana (SPL Token)
*   **实现**: 构造一个 SPL Token `Transfer` 指令。
*   **CPI**: 调用 Token Program ID (`TokenkegQfe...`)。
*   **账户**: 自动将 `source`, `destination`, `authority` 账户推入 CPI 上下文。

### 2.2 Near (NEP-141)
*   **实现**: 构造一个跨合约调用 (`ft_transfer`)。
*   **存储押金**: 自动处理 Near 特有的 `storage_deposit` (如果需要)。

### 2.3 Arbitrum Stylus (ERC-20)
*   **实现**: 编码 ABI `transfer(address,uint256)`。
*   **Call**: 执行 EVM Call。

## 3. 扩展接口

### 3.1 Metadata (元数据)
统一获取代币名称、符号、小数位。
*   Solana: 查询 Metaplex Metadata PDA。
*   EVM: 查询 `name()`, `symbol()`, `decimals()`。

### 3.2 Mintable / Burnable
统一的增发和销毁接口。

## 4. 虚拟代币 (Virtual Tokens)

Titan OS 还支持定义 **"Native Zig Token"**，即完全用 Zig 编写逻辑的代币（类似 ERC-20 在 Stylus 上）。
对于这种代币，标准库提供默认实现：

```zig
const MyToken = titan.token.Define({
    .name = "Titan Coin",
    .symbol = "TITAN",
    .decimals = 9,
});
```
