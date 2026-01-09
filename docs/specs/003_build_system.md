# 规范 003: 构建系统设计 (Build System)

本规范定义了 `build.zig` 的行为和命令行接口 (CLI)。构建系统是 Titan OS 的“控制台”，负责根据目标链配置编译参数。

**设计原则**: 构建输出需保持资源/IO 抽象一致性，确保不同后端对外暴露相同的 IO 语义。

## 1. 命令行接口 (CLI)

开发者通过标准 Zig 构建命令与系统交互。我们不引入额外的 Python 或 Shell 脚本，保持纯 Zig 工具链体验。

### 1.1 指定目标链 (`-Dtarget_chain`)

这是核心开关，决定了代码将编译为何种架构。

```bash
# 编译为 Solana SBF (.so)
# 对应架构: bpfel-freestanding-none (或 sbf-solana-solana)
zig build -Dtarget_chain=solana

# 编译为 Near Wasm (.wasm)
# 对应架构: wasm32-freestanding
zig build -Dtarget_chain=near

# 编译为通用 Wasm (.wasm)
# 对应架构: wasm32-freestanding
zig build -Dtarget_chain=generic_wasm

# 运行本地测试 (使用 Mock 内核)
# 对应架构: 本机架构 (x86_64/aarch64)
zig build test
```

### 1.2 优化选项 (`-Doptimize`)

继承 Zig 的标准优化选项：

*   `Debug` (默认): 开启所有安全检查，未优化。适合开发。
*   `ReleaseSmall`: **生产环境推荐**。最小化二进制体积 (Binary Size)，对区块链部署成本至关重要。
*   `ReleaseFast`: 最大化性能，但可能会增加体积。
*   `ReleaseSafe`: 优化性能但保留安全检查。

示例：
```bash
zig build -Dtarget_chain=solana -Doptimize=ReleaseSmall
```

## 2. 输出产物 (Artifacts)

构建系统必须将最终产物放置在统一的输出目录 `zig-out/bin/` 下，以便 CI/CD 工具拾取。

*   **Solana**: `zig-out/bin/project_name.so`
    *   注意：SBF 加载器要求 `.so` 扩展名（尽管它不是标准的 ELF 共享库）。
*   **Wasm**: `zig-out/bin/project_name.wasm`

## 3. 内部实现逻辑

`build.zig` 的职责不仅仅是调用编译器，它还需要充当“元编程注入器”。

1.  **动态 Target 选择**:
    *   如果 `target_chain=solana`，强制设置 `target = bpfel-freestanding-none`，CPU 模型设置为 `generic` 或 `v3`。
    *   如果 `target_chain=wasm`，强制设置 `target = wasm32-freestanding`。

2.  **Options 注入**:
    *   利用 `b.addOptions()` 将 `target_chain` 的值注入到 `build_options` 模块中。
    *   这使得源码可以通过 `@import("build_options").target_chain` 在编译时感知当前目标。

3.  **依赖管理**:
    *   Titan 框架本身作为一个模块 (`titan_module`) 被注入到用户应用中。
    *   标准库路径自动映射。

## 4. 链接器脚本 (Linker Scripts)

对于 Solana，我们可能需要自定义的链接器脚本 (`sbf.ld`) 来确保代码段和数据段符合 Solana VM 的内存布局要求（例如，入口点必须位于 text 段的起始位置）。构建系统应自动处理此脚本的传递。
