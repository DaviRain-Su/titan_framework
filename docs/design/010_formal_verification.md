# 设计 010: 形式化验证 (Formal Verification)

> 状态: 规划中 (V3 Target)
> 目标: 让 Titan 合约能够数学证明其安全性，消除逻辑漏洞。

## 1. 验证策略 (Verification Strategy)

我们不重新发明验证工具。Titan OS 的策略是 **"Model Export" (模型导出)**。
我们将 Zig 代码（或其 IR）转换为成熟验证工具（如 **Move Prover**, **K Framework**, **Coq**）能理解的格式。

## 2. 规范语言 (Spec Language)

我们在 Zig 代码中引入一种特殊的注释语法（类似 JML 或 ACSL），用于描述不变量 (Invariants)。

```zig
/// @invariant balance <= total_supply
/// @pre amount > 0
/// @post return_value == old(balance) - amount
pub fn withdraw(amount: u64) !u64 {
    // ...
}
```

## 3. 验证管线 (Pipeline)

1.  **解析**: Titan 编译器前端提取 `@invariant` 等注解。
2.  **转换**: 将 Zig AST + 注解 转换为 **SMT-LIB 2.0** 格式（Z3 Solver 的标准输入）。
3.  **求解**: 调用 Z3 / CVC5 求解器。
4.  **报告**: 如果求解器找到反例 (Counter-example)，将其翻译回 Zig 代码的行号，告诉用户哪里有 Bug。

## 4. 核心不变量 (Core Invariants)

Titan 标准库将内置一系列经过验证的不变量：

*   `titan.token`: 保证总供应量等于所有余额之和。
*   `titan.math`: 保证所有运算无溢出。

## 5. 符号执行 (Symbolic Execution)

除了静态验证，Titan OS 还将集成 **KLEE** 或 **Manticore** 进行符号执行。
*   自动探索所有可能的执行路径。
*   在没有具体输入的情况下，发现 Panic 或越界错误。
