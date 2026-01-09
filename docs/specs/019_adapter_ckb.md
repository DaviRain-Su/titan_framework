# 规范 019: Nervos CKB 适配器规范 (Nervos Adapter)

> 状态: 规划中 (V3 Target)
> 核心挑战: 将 Titan 的 **Mutable KV** 接口映射到 CKB 的 **Immutable Cell** 模型。

## 1. 架构映射 (Architecture Mapping)

Nervos CKB 使用 **RISC-V** 指令集运行智能合约（Scripts）。Zig 原生支持 RISC-V 交叉编译，因此代码执行不是问题。难点在于状态模型。

| Titan 概念 | CKB 概念 | 适配策略 |
| :--- | :--- | :--- |
| **Contract** | **Type Script** | Titan 内核编译为 RISC-V 二进制，作为 Type Script 运行。 |
| **Storage** | **Cell Data** | 将 KV 数据序列化存储在 Output Cell 的 Data 字段中。 |
| **Transaction** | **State Transition** | `set` 操作不修改内存，而是声明 Output Cell 的内容。 |

## 2. 状态模型适配 (State Adapter)

Titan 的 `storage.set("key", val)` 暗示了原地修改。CKB 要求“销毁旧 Cell，生成新 Cell”。

### 2.1 虚拟状态机 (Virtual State Machine)
Titan 内核在 CKB 上维护一个虚拟的状态机：

1.  **加载 (Load)**:
    *   在交易开始时，内核扫描 `Input Cells`。
    *   找到包含当前合约状态的 Cell（通常通过 Type Script Hash 识别）。
    *   解析 Cell Data，构建内存中的 KV 缓存。

2.  **执行 (Execute)**:
    *   运行用户 `main` 函数。
    *   用户调用 `storage.set` 修改内存缓存。

3.  **提交 (Commit)**:
    *   交易结束时，内核检查内存缓存的变化。
    *   **关键步骤**: 内核必须验证交易的 `Output Cells` 中，是否包含了一个与新状态一致的 Cell。
    *   *注意*: CKB 的脚本通常是验证器 (Validator)。它不产生数据，而是验证“Input -> Output”的变换是否合法。

### 2.2 验证逻辑 (Validation Logic)
在 CKB 上，Titan 代码实际上是一个**验证规则**：
*   “如果你想修改状态（生成新 Cell），新状态必须等于旧状态 + 逻辑变化。”

```zig
// Titan CKB Kernel Logic
export fn _start() i8 {
    // 1. 读取 Input Cell Data (Old State)
    const old_state = load_cell_data(0, .input);
    
    // 2. 运行业务逻辑，计算预期的新状态
    const expected_new_state = run_user_logic(old_state);
    
    // 3. 读取 Output Cell Data (Proposed New State)
    const actual_new_state = load_cell_data(0, .output);
    
    // 4. 验证一致性
    if (!std.mem.eql(u8, expected_new_state, actual_new_state)) {
        return -1; // 验证失败：用户试图进行非法状态转换
    }
    return 0;
}
```

## 3. 系统调用映射 (Syscalls)

CKB 提供了丰富的 `ckb_syscalls`。

*   `load_cell_data`: 对应 Titan 的 `storage.get` (从 Input 读取)。
*   `debug`: 对应 Titan 的 `log`。

## 4. 限制 (Limitations)

*   **状态竞争**: 由于 UTXO 的特性，多人同时修改同一个 Cell 会导致竞争（只有一笔交易能上链）。这与 Solana/Near 的体验不同。
*   **并发模型**: Titan on CKB 更适合由单一用户控制状态的应用（如 NFT、个人资产），而不适合高并发的全局状态应用（如 DEX AMM）。

## 5. 结论

支持 CKB 极大地拓展了 Titan OS 的边界，使其能够覆盖 **Extended UTXO** 范式。虽然编程模型变成了“状态验证”而非“状态修改”，但通过内核层的抽象，用户依然可以写出类似 KV 修改的逻辑。
