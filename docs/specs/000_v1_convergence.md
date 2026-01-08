# 规范 000: V1 版收敛设计稿 (V1 Convergence Spec)

> 状态: **已生效 (Approved)**
> 目的: 修正并统一之前所有设计文档中的冲突与风险点。本规范优先级高于其他所有 Spec。

## 1. 核心接口修正 (Core Interface Fixes)

### 1.1 错误处理 (Error Handling)
**问题**: Zig `error set` 不支持 payload (`Error.Custom(u32)` 无效)。
**修正**:
*   定义纯枚举错误集 `titan.Error`。
*   引入副作用函数 `set_custom_code`。

```zig
// Titan Error Set
pub const Error = error {
    OutOfMemory,
    InvalidInput,
    CustomError, // 配合 set_custom_code 使用
};

// 辅助函数
pub fn set_custom_code(code: u32) void;
```

### 1.2 输入读取 (Input Reading)
**问题**: 语义冲突（Buffer vs Slice）与零拷贝策略。
**修正**:
*   **Syscall 层 (Kernel)**: `read_input(ptr: [*]u8, len: usize) usize`。调用方负责分配内存。这兼容 Wasm (需拷贝) 和 Solana (SBF loader 机制)。
*   **User 层 (API)**: 提供两个变体。
    1.  `read_input_copy(allocator)`: 分配并拷贝 (通用)。
    2.  `read_input_slice()`: **仅 Solana 可用**，返回 `AccountInfo.data` 的直接引用 (零拷贝)。

### 1.3 存储读取 (Storage Read)
**问题**: `technical_stack.md` 中错误引用了 `sol_get_return_data`。
**修正**:
*   **Solana**: 映射为对 `AccountInfo.data` 的直接内存访问。Titan 必须维护一个 `Context` 对象，其中包含当前账户的 Data Slice。
*   **Near**: 映射为 `near_sys.storage_read`。

## 2. 架构降级与简化 (Scope Reduction)

### 2.1 Async 模型
**决定**: **放弃 V1 自动代码切割**。
**新设计**: 仅支持 **显式状态机 (Explicit State Machine)**。
用户必须手动将逻辑拆分为 `fn step1()` 和 `fn step2()`，并通过 `titan.async.callback(step2)` 连接。

### 2.2 Solana KV 模拟
**决定**: **放弃通用 KV 模拟 (B-Tree)**。
**新设计**: **Struct-based Mapping**。
用户定义一个大结构体 `MyAccountData`，Titan 将其直接序列化到 Account Data 中。不支持动态增长的 `HashMap`，仅支持固定布局或简单的 `ArrayList`（尾部增长）。

**V1 约束**:
*   **不提供** `titan.storage.set/get` KV 接口。
*   **主状态账户**: `Context.accounts` 中 **第一个 `is_writable = true` 的账户**。
    *   若不存在可写账户，返回 `Error.InvalidInput`。
*   **访问方式**: 仅支持显式结构体映射。

```zig
// V1 storage access (Struct-based Mapping only)
var state = ctx.accounts[state_index].load_as(MyAccountData);
state.counter += 1;
try ctx.accounts[state_index].save(state);
```

## 3. IDL 生成策略 (IDL Strategy)

**问题**: Zig `@typeInfo` 无法稳定获取函数参数名。
**修正**: **强制 Struct 入口参数**。

```zig
// ✅ 正确写法
const MyArgs = struct {
    amount: u64,
    recipient: Address,
};

pub fn transfer(ctx: Context, args: MyArgs) !void { ... }
```

Titan 构建系统将反射 `MyArgs` 结构体的字段名来生成 IDL。

## 4. 统一 Token 接口增强

**问题**: 参数不足以覆盖 Near/Solana 差异。
**修正**: 引入 `extra` 字段。

```zig
pub const TransferOptions = struct {
    // 通用
    memo: ?[]const u8 = null,
    
    // Near 专用
    attached_deposit: u128 = 0,
    
    // Solana 专用 (传递额外账户)
    remaining_accounts: []AccountInfo = &.{},
};

pub fn transfer(to: Address, amount: u64, opts: TransferOptions) !void;
```

## 5. V1 最小可用范围 (MVP Scope)

为了确保落地，V1 阶段仅包含：

1.  **链支持**: Solana (SBF) + Mock Runtime。
    *   *暂缓 Near/Wasm 支持，直到 Solana 跑通。*
2.  **功能**:
    *   日志 (Log)
    *   基础内存分配 (Bump Allocator)
    *   输入解析 (Borsh Struct)
    *   简单状态读写 (Direct Struct Mapping)
    *   CPI (Solana 原生)

**V1 约束**:
*   所有会分配内存的 API 必须显式传入 `allocator`，不允许隐式分配。

**结论**: 我们先做一个 **"Better Anchor for Zig"**，跑通后再扩展到 Wasm。
