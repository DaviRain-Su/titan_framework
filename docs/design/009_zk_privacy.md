# 设计 009: 零知识隐私架构 (ZK Privacy Architecture)

> 状态: 规划中 (V3 Target)
> 核心战略: **Zig as a ZK DSL**。通过转译技术，让开发者使用 Zig 编写电路。

## 1. 终极愿景

我们不强制开发者学习 Noir 或 Circom。Titan OS 的编译器将支持把 Zig 代码的一个受限子集 (**Titan-Z**) 转译为 **Noir** 代码。

**Write Circuits in Zig.**

## 2. 标注与导出机制 (Annotation & Export)

Titan OS 采用 **“文档注释说明 + 编译时显式导出”** 的双重机制，确保 ZK 电路既易于阅读，又受到 Zig 类型系统的严格约束。

### 2.1 标注规范 (The Hybrid Standard)

1.  **Doc Comment (`/// @zk_circuit`)**: 用于标记函数为电路，并提供给转译器（Transpiler）解析。
2.  **Comptime Export**: 用户必须在一个公共常量中导出电路函数，以便构建系统（Build System）能够准确识别入口。

### 2.2 代码示例

```zig
const std = @import("std");
const zk = @import("titan.zk");

/// @zk_circuit
/// 这是一个验证用户密码哈希的电路。
/// 限制：输入必须是 256 位字段元素。
pub fn check_password(public_hash: u256, secret_password: u256) bool {
    const computed = zk.hash(secret_password);
    return computed == public_hash;
}

// 显式导出：Titan CLI 将扫描此常量
pub const __titan_zk_circuits = .{
    .verify_password = check_password,
};
```

## 3. 架构流程 (The Transpilation Pipeline)

1.  **扫描 (Scan)**: Titan CLI 扫描 `src/` 下所有导出了 `__titan_zk_circuits` 的文件。
2.  **验证 (Verify)**: 利用 Zig 编译器的 `ast-check` 验证语法，并根据 Doc Comment 提取元数据。
3.  **转译 (Transpile)**: 将 Zig AST 的受限子集转译为 Noir 源码 (`.nr`)。
4.  **编译 (Build)**: 调用 `nargo` 生成 ACIR。

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
