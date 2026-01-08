# 规范 009: Solana 适配器规范 (Solana Adapter)

本规范定义了 Titan OS 如何在底层对接 Solana SBF (Sealevel) 运行时。

## 1. 入口点 (Entrypoint)

Solana 程序的入口是：
```zig
export fn entrypoint(input: [*]u8) u64
```

### 1.1 输入数据布局
`input` 指针指向一个序列化的字节流：
1.  `num_accounts` (u64, little-endian)
2.  `AccountInfo` 数组 (见 1.2)
3.  `instruction_data_len` (u64, little-endian)
4.  `instruction_data` (bytes)
5.  `program_id` (Pubkey, 32 bytes)

**Titan 内核职责**:
在 `_start` 阶段，内核必须解析这个字节流，并将其转换为 Titan 的标准 `Context` 结构体。

### 1.2 AccountInfo 字节布局 (Critical for V1)

每个 `AccountInfo` 在输入流中的布局如下（**无对齐填充，紧凑排列**）：

```
Offset  Size    Field               Description
──────────────────────────────────────────────────────────────
0       1       is_duplicate        0 = 首次出现, 0xFF = 重复引用 (跳过)
                                    若 0xFF，后续仅跟随 4 字节索引

以下字段仅当 is_duplicate = 0 时存在：
1       1       is_signer           0 = false, 1 = true
2       1       is_writable         0 = false, 1 = true
3       1       executable          0 = false, 1 = true
4       4       _padding            (原始布局要求，可忽略内容)
8       32      key                 账户公钥 (Pubkey)
40      32      owner               所有者程序公钥
72      8       lamports            账户余额 (u64, little-endian)
80      8       data_len            数据长度 (u64)
88      N       data                账户数据 (N = data_len, 8字节对齐填充)
88+N'   8       rent_epoch          租期纪元 (u64)
──────────────────────────────────────────────────────────────
```

**Zig 结构体定义:**
```zig
pub const AccountInfo = struct {
    key: *const Pubkey,
    lamports: *u64,
    data: []u8,
    owner: *const Pubkey,
    rent_epoch: u64,
    is_signer: bool,
    is_writable: bool,
    executable: bool,
};
```

### 1.3 返回值语义

| 返回值 | 含义 | Titan Error |
| :--- | :--- | :--- |
| `0` | 成功 | - |
| `1` | 自定义错误 (配合 `set_custom_code`) | `CustomError` |
| `0x100000000` | InvalidInput | `InvalidInput` |
| `0x100000001` | InvalidAccountData | `InvalidInput` |
| `0x100000002` | AccountDataTooSmall | `OutOfMemory` |
| `0x100000003` | InsufficientFunds | `Unauthorized` |
| `0x100000004` | IncorrectProgramId | `InvalidInput` |
| `0x100000005` | MissingRequiredSignature | `Unauthorized` |

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

**命名约定**: `titan.sbf.Context` 指向 `SolanaContext`。

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
