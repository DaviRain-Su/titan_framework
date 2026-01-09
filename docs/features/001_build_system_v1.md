# Feature 001: 构建系统 V1 (Build System V1)

> 状态: 待实现
> 所属 Story: [001-内核引导](../../stories/001-kernel-bootstrap.md)

**设计原则**: 构建输出必须保持统一的资源/IO 抽象语义。

## 1. 背景与目标
目前的 Zig 默认构建脚本仅支持单一目标。为了实现 Titan OS 的多链愿景，我们需要一个能够动态切换编译目标（Target Triple）、链接器脚本和依赖模块的智能构建系统。

## 2. API 变更 (CLI Changes)

用户通过 `zig build` 命令行与系统交互。本特性将引入以下选项：

```bash
# 新增选项: target_chain
# 类型: enum { solana, near, generic_wasm, mock }
# 默认: mock (本地测试)

# 示例 1: 编译 Solana 内核
zig build -Dtarget_chain=solana -Doptimize=ReleaseSmall

# 示例 2: 编译 Near 合约
zig build -Dtarget_chain=near

# 示例 3: 运行本地单元测试
zig build test
```

## 3. 实现细节

### 3.1 文件修改
*   **修改**: `build.zig` (重写核心逻辑)
*   **新增**: `src/build_options.zig` (由构建系统自动生成的代码，不在源码库中)

### 3.2 核心逻辑 (`build.zig`)

构建脚本将执行以下逻辑分支：

1.  **解析参数**: 获取 `target_chain` 选项。
2.  **设置 Target Triple**:
    *   `solana` -> `bpfel-freestanding-none` (CPU: `v3`)
    *   `near/generic` -> `wasm32-freestanding`
    *   `mock` -> `native`
3.  **模块注入**:
    *   创建 `options` 模块，包含 `pub const target_chain = ...;`。
    *   将此模块注入到 `titan` 模块中。
4.  **架构映射**:
    *   定义 `arch_module`。
    *   如果 `solana`，指向 `src/arch/sbf/mod.zig`。
    *   如果 `wasm`，指向 `src/arch/wasm/mod.zig`。
    *   将 `arch_module` 作为 `arch_backend` 导入名注入到 `titan` 模块。

### 3.3 输出路径
强制指定输出目录：
*   `.so` -> `zig-out/bin/titan_app.so`
*   `.wasm` -> `zig-out/bin/titan_app.wasm`

## 4. 测试计划

*   [ ] **空运行验证**: `zig build --help` 应显示 `target_chain` 选项。
*   [ ] **Solana 构建**: 运行构建命令，检查是否生成 `.so` 文件。
*   [ ] **Wasm 构建**: 运行构建命令，检查是否生成 `.wasm` 文件。
*   [ ] **选项传递验证**: 在代码中打印 `build_options.target_chain`，确认值正确。

## 5. 变更日志预览

### Added
- [Build] 引入 `-Dtarget_chain` 选项，支持 `solana`, `near`, `generic_wasm`, `mock`。
- [Build] 实现基于 Target 的动态模块注入机制。
