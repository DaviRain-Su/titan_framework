# 设计 009: 零知识隐私架构 (ZK Privacy Architecture)

> 状态: 规划中 (V3 Target)
> 核心战略: **Zig as a ZK DSL**。通过转译技术，让开发者使用 Zig 编写电路。

## 1. 终极愿景

我们不强制开发者学习 Noir 或 Circom。Titan OS 的编译器将支持把 Zig 代码的一个受限子集 (**Titan-Z**) 转译为 **Noir** 代码。

**Write Circuits in Zig.**

## 2. 架构流程 (The Transpilation Pipeline)

1.  **编写**: 用户在 `.zig` 文件中编写带有 `@zk` 标注的函数。
2.  **转译 (titan-zk)**:
    *   解析 Zig AST。
    *   检查约束 (无动态循环，无指针)。
    *   生成 `.nr` (Noir) 源码。
3.  **编译**: 调用 `nargo` 将 `.nr` 编译为证明密钥 (Proving Key) 和验证密钥 (Verifying Key)。
4.  **集成**: 自动生成 Zig 验证器代码，供合约调用。

## 3. 代码示例

```zig
const std = @import("std");
const zk = @import("titan.zk");

/// @zk_circuit
/// 这是一个 ZK 电路，不是普通函数
pub fn check_password(public_hash: u256, secret_password: u256) bool {
    // 这里的 hash 会被转译为 Noir 的 std::hash::pedersen
    const computed = zk.hash(secret_password);
    
    // 生成约束: computed == public_hash
    return computed == public_hash;
}
```

## 4. 语义映射 (Semantic Mapping)

| Zig 概念 | Noir 映射 | 限制 |
| :--- | :--- | :--- |
| `u64/u256` | `Field` | 模数运算语义差异需处理 |
| `if (cond) a else b` | `if cond { a } else { b }` | 必须可展开为 Mux 门 |
| `inline for` | `for` (Unrolled) | 循环次数必须编译时确定 |
| `struct` | `struct` | 无指针引用 |

## 5. 价值主张

这是 Titan OS 统一体验的最后一块拼图。
*   **统一语言**: 合约用 Zig，驱动用 Zig，工具用 Zig，**现在连电路也用 Zig**。
*   **工具复用**: 复用 Zig 的 LSP (自动补全、跳转)，不需要为 Noir 单独配置编辑器环境。

## 6. 备选方案

如果转译难度过大，回退到 **"Inline Noir"** 方案：
在 Zig 文件中通过字符串字面量嵌入 Noir 代码（类似 Rust 的 `asm!` 宏）。
