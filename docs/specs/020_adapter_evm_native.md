# 规范 020: EVM 适配器套件 (EVM Adapter Suite)

> 状态: 规划中 (V3 Target)
> 核心策略: **双引擎架构 (Dual-Engine Architecture)**。
> 目标: 既能通过转译覆盖所有 EVM 链，又能通过专用后端深入支持高性能 zkEVM。

## 1. 策略 A: 通用转译 (Zig -> Yul)

适用于以太坊主网、Optimism、Base 等标准 EVM 链。

### 1.1 架构映射
*   **Zig AST** -> **Yul Source** -> **solc** -> **EVM Bytecode**。
*   **优势**: 100% 兼容性，无需修改底层编译器。
*   **劣势**: 无法利用 LLVM 的机器码优化 pass。

### 1.2 关键实现
*   **算术**: 将 Zig `u64` 提升为 Yul `u256`。
*   **存储**: `storage.set` 映射为 `sstore`。
*   **内存**: 简单的 Free Memory Pointer 管理。

## 2. 策略 B: 专用后端 (Zig -> LLVM -> EraVM)

适用于 **zkSync Era** 生态。zkSync 开发了一套基于 LLVM 的编译器后端，专门将 LLVM IR 编译为 EraVM 字节码。

### 2.1 架构映射
*   **Zig** -> **LLVM IR** -> **zkSync Backend** -> **EraVM Bytecode**。
*   **优势**: 极致性能。Zig 的 `ReleaseFast` 优化可以直接传递给 EraVM。
*   **集成方式**:
    1.  Zig 编译器输出 `.ll` 或 `.bc` (LLVM IR 文件)。
    2.  调用 `era-compiler-llvm` 工具处理该 IR。

### 2.2 扩展能力
*   **原生支持**: EraVM 原生支持指针和堆栈操作，比标准 EVM 更接近 LLVM 模型。这意味着 Zig 代码在 zkSync 上跑起来可能比在以太坊主网上更自然、更高效。

## 3. 策略选择 (Selection)

用户在 `build.zig` 中指定：

```bash
# 通用 EVM (生成 Yul)
zig build -Dtarget_chain=evm_generic

# zkSync 专用 (生成 EraVM 汇编)
zig build -Dtarget_chain=zksync
```

## 4. 结论

通过“双引擎”策略，Titan OS 既保持了对 EVM 生态的广泛覆盖，又抓住了 zkEVM 的高性能未来。这是一套“进可攻，退可守”的完美方案。