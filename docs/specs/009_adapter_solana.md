# 规范 009: Solana 适配器规范 (Solana Adapter)

本规范定义了 Titan OS 如何在底层对接 Solana SBF (Sealevel) 运行时。

## 1. 入口点 (Entrypoint)

Solana 程序的入口是：
```zig
export fn entrypoint(input: [*]u8) u64
```

### 1.1 输入数据布局
`input` 指针指向一个序列化的字节流：
1.  `num_accounts` (u64)
2.  `AccountInfo` 数组
3.  `instruction_data_len` (u64)
4.  `instruction_data` (bytes)
5.  `program_id` (Pubkey)

**Titan 内核职责**:
在 `_start` 阶段，内核必须解析这个字节流，并将其转换为 Titan 的标准 `Context` 结构体。

## 2. 系统调用映射 (Syscalls)

所有 `extern` 函数声明在 `src/arch/sbf/syscalls.zig`。

| Titan API | Solana Syscall | 签名 |
| :--- | :--- | :--- |
| `log(msg)` | `sol_log_` | `fn(*u8, u64)` |
| `sha256(data)` | `sol_sha256` | `fn(*u8, u64, *u8)` |
| `call(...)` | `sol_invoke_signed_c` | `fn(*Instruction, *AccountInfo, ...)` |

## 3. 内存分配 (Allocator)

Solana 提供了 32KB 的堆。
*   **V1 实现**: 使用 `HEAP_START_ADDRESS` (0x300000000) 实现一个简单的 Bump Allocator。
*   **V2 实现**: 如果 Solana 未来支持动态堆 (Heap Frame)，适配之。

## 4. 账户模型适配 (The Account Model)

### 4.1 V1 规则: Struct-based Mapping Only

V1 不提供 `titan.storage.set/get` KV 接口，存储仅允许显式结构体映射。

### 4.2 SolanaContext (V1)

Solana 后端提供扩展上下文以承载账户模型信息。

```zig
pub const SolanaContext = struct {
    /// All accounts passed to the program.
    accounts: []AccountInfo,
    /// Instruction data bytes (Borsh by default).
    instruction_data: []const u8,
    /// Current program id.
    program_id: Pubkey,
    /// V1 rule: first writable account index.
    state_account_index: usize,
};
```

*   **主状态账户选择**: `accounts` 中第一个 `is_writable = true` 的账户。
*   **失败行为**: 如果不存在可写账户，返回 `Error.InvalidInput`。

```zig
// Example: load/save explicit struct state
var state = ctx.accounts[state_index].load_as(MyAccountData);
state.counter += 1;
try ctx.accounts[state_index].save(state);
```

## 5. Panic 处理
调用 `sol_panic_` 导致交易失败并打印日志。
