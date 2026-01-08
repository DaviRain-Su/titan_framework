# 设计 006: 异步编程模型 (Async Programming Model)

> 状态: 草稿
> 难度: 极高 (Core Architecture)

## 1. 核心挑战 (The Challenge)

区块链世界的执行模型分裂为两大阵营：

1.  **原子同步 (Atomic/Sync)**: 如 **Solana**, Aptos, Sui。
    *   调用其他合约 (`CPI`) 是立即完成的。
    *   所有逻辑在一个交易内原子执行。
    *   代码风格: `let bal = token.balance_of(user);` (直接拿到值)

2.  **异步消息 (Async/Message)**: 如 **Near**, **TON**, Polkadot, Eth L2 (跨链)。
    *   调用其他合约是“发射并遗忘” (Fire-and-Forget) 或“注册回调”。
    *   逻辑被拆分为多个区块/交易。
    *   代码风格: `token.balance_of(user).then(callback);`

Titan OS 的终极目标是：**用户只需写一种逻辑，编译器自动适配两种模型。**

## 2. 抽象方案: `TitanPromise`

我们引入 `TitanPromise<T>` 概念。这是一种编译时的多态类型。

```zig
const titan = @import("titan");

pub fn check_balance_and_withdraw(user: Address) !void {
    // 1. 发起跨合约调用
    // 返回值是一个 Promise
    const balance_future = titan.token.balance_of(user);

    // 2. 等待结果 (await)
    // 这一步是魔法所在
    const balance = try balance_future.await_result();

    // 3. 后续逻辑
    if (balance > 100) {
        try titan.token.transfer(user, 100);
    }
}
```

## 3. 编译时分叉 (Compiler Divergence)

`await_result()` 函数在不同架构下有完全不同的实现：

### 3.1 场景 A: Solana (同步模式)
在 Solana 上，`await_result()` 会被编译为：
*   **立即执行** `sol_invoke_signed`。
*   解析返回数据 (`return_data`)。
*   **直接返回**结果。
*   *性能开销*: 零。这就是普通的函数调用。

### 3.2 场景 B: Near/TON (异步模式)
这是最复杂的部分。Zig 编译器需要进行 **CPS 变换 (Continuation-Passing Style)** 或 **状态机生成**。

由于 Zig 目前没有原生的 Async/Await (暂被移除)，我们采用 **“回调展开” (Callback Unrolling)** 策略。

**构建系统的魔法**:
当目标是 `near` 时，编译器（或者我们的预处理工具）会将 `await_result` 之后的代码**切割**到一个新的回调函数中。

```zig
// 伪代码: 编译到 Near 时的自动代码生成
pub fn check_balance_and_withdraw(user: Address) {
    // 1. 发起调用
    let promise_id = promise_create(..., "balance_of", ...);
    
    // 2. 注册回调 (指向生成的 part2 函数)
    promise_then(promise_id, ..., "check_balance_callback", ...);
}

// 自动生成的后续逻辑
export fn check_balance_callback() {
    // 1. 获取结果
    let balance = promise_result();
    
    // 2. 原来的后续逻辑
    if (balance > 100) {
        // ...
    }
}
```

## 4. 受限的编程模型

为了让这种自动切割可行，Titan OS 对异步代码施加限制：

1.  **顶层 Await**: `await_result()` 只能在主业务逻辑中调用，不能深层嵌套。
2.  **状态持久化**: 在 `await` 之前的局部变量，如果 `await` 之后还需要用，必须能够被序列化（自动保存到合约状态或闭包中）。

## 5. 显式异步 (Alternative: Explicit Async)

如果自动切割太激进，我们也可以提供显式 API：

```zig
// 用户显式定义两段逻辑
pub fn step1(ctx: Context) !void {
    // 发起调用，并告诉系统下一步去哪
    try titan.async.call(token, "balance_of", .{}, .callback = step2);
}

pub fn step2(ctx: Context, result: u64) !void {
    if (result > 100) { ... }
}
```

**设计决策**: V1 版本优先支持 **显式异步** (Explicit Async)，因为这更容易实现且更透明。V2 版本再尝试实现基于 AST 分析的自动切割 (Implicit Async)。
