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

Titan 的 `storage.get/set` 在 Solana 上如何工作？

*   **默认模式**: 假设当前程序管理一个主状态账户。
*   **实现**:
    *   `storage.set(k, v)` -> 修改主账户 `data` 字段中的对应偏移量。
    *   这要求 Titan 在 Account Data 内部实现一个微型文件系统或 KV 结构。

## 5. Panic 处理
调用 `sol_panic_` 导致交易失败并打印日志。
