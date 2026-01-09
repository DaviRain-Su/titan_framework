# 设计 006: 异步编程模型 (Async Programming Model)

> 状态: 规划中 (V2 Target)
> 核心问题: 如何统一处理 Solana (Sync) 和 Near (Async) 的调用逻辑？

**设计原则**: 异步/同步调用都视为资源 IO 操作，差异由后端驱动处理。

## 1. 核心挑战

*   **Solana**: `call()` 是原子的，直接返回结果。
*   **Near**: `call()` 是异步的，返回 Promise ID。当前交易结束，结果在下一笔交易的回调中处理。

## 2. 解决方案: 显式状态机 (Explicit State Machine)

Titan OS V1/V2 不做隐式的编译器魔法 (Async/Await)。我们要求用户显式定义状态机。

### 2.1 API 设计

```zig
const titan = @import("titan");

// 定义状态结构体 (必须可序列化)
const SwapState = struct {
    user: Address,
    amount_in: u64,
    min_out: u64,
};

// 步骤 1: 发起调用
pub fn swap_step1(ctx: Context, args: SwapArgs) !void {
    // 保存中间状态
    const state = SwapState { ... };
    
    // 发起异步调用
    // 在 Solana 上: 立即执行 balance_of，然后立即调用 swap_step2
    // 在 Near 上: 发起 promise，注册 swap_step2 为回调
    try titan.async.call(
        .target = token_program,
        .method = "balance_of",
        .args = .{ args.user },
        .callback = swap_step2, // 下一步函数
        .state = state,         // 传递状态
    );
}

// 步骤 2: 处理结果
pub fn swap_step2(ctx: Context, result: u64, state: SwapState) !void {
    if (result < state.amount_in) return error.InsufficientBalance;
    // ...
}
```

## 3. 实现原理 (Under the Hood)

### 3.1 Solana 实现 (Sync Wrapper)
`titan.async.call` 在 Solana 上是一个简单的 wrapper：

```zig
// Solana implementation
pub fn call(..., callback: anytype, state: anytype) !void {
    // 1. 同步执行 CPI
    const result_data = try sol_invoke(...);
    const result = deserialize(result_data);

    // 2. 立即调用回调
    try callback(ctx, result, state);
}
```

### 3.2 Near 实现 (Promise Chain)
`titan.async.call` 在 Near 上操作 Promise：

```zig
// Near implementation
pub fn call(..., callback: anytype, state: anytype) !void {
    // 1. 序列化状态
    const state_bytes = serialize(state);
    
    // 2. 创建 Promise
    const id = promise_create(...);
    
    // 3. 注册回调 (Tell host to call `callback` with `state`)
    promise_then(id, self_address, "swap_step2", state_bytes, ...);
}
```

## 4. 局限性
*   用户必须手动拆分逻辑。
*   状态对象 (`state`) 的大小受限于链的参数限制 (Near 较宽松，Solana 无此限制因内存共享)。

这种设计虽然繁琐，但它是**显式、零魔法且类型安全**的。
