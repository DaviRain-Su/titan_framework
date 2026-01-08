# 设计 001: 内核结构与构建策略

> 状态: 草稿
> 关联故事: [001-内核引导](../../stories/001-kernel-bootstrap.md)

## 1. 概述 (Overview)

受 Linux 内核源码树的启发，Titan OS 采用了 **架构相关代码 (`arch/`)** 与 **架构无关代码 (`kernel/`, `mm/`, `include/`)** 严格分离的设计。

这种设计确保了：
1.  用户应用的可移植性（一次编写，到处运行）。
2.  添加新链支持（例如 RISC-V）时，只需在 `arch/` 下添加一个新文件夹，无需修改核心逻辑。

## 2. 目录结构 (“Linux” 布局)

我们将重构 `src/` 目录以遵循此布局：

```text
src/
├── arch/                   # 架构相关代码 (硬件抽象层 HAL)
│   ├── sbf/                # Solana 字节码格式 (Solana 专用)
│   │   ├── entrypoint.zig  # _start / 入口点符号
│   │   ├── syscalls.zig    # sol_log, sol_invoke 的封装
│   │   └── mm.zig          # 堆分配器实现
│   │
│   └── wasm/               # WebAssembly (通用/Near 专用)
│       ├── entrypoint.zig  # 导出函数
│       ├── host.zig        # env 导入 (near_sdk 等)
│       └── mm.zig          # 线性内存分配器
│
├── kernel/                 # 核心子系统 (架构无关)
│   ├── panic.zig           # 统一 Panic 处理器
│   └── syscalls.zig        # 抽象系统调用接口 (调用 arch/*)
│
├── mm/                     # 内存管理子系统 (Memory Management)
│   ├── allocator.zig       # 统一 TitanAllocator 接口
│   └── page.zig            # 页级抽象 (未来可选)
│
├── include/                # 公共 API (用户空间头文件)
│   └── titan.zig           # @import("titan") 的主入口
│
└── lib/                    # 标准库 (用户空间)
    ├── math/               # 安全数学库
    └── collections/        # 优化的列表/映射 (Lists/Maps)
```

## 3. 构建系统设计 (`build.zig`)

构建系统充当“内核配置”工具（类似 Linux 的 Kconfig）。

### 3.1 选项 (Options)

我们定义一个通过 `build_options` 暴露的自定义 `Options` 结构体：

```zig
pub const TargetChain = enum {
    solana,
    near,
    generic_wasm,
    mock, // 用于本地测试
};
```

### 3.2 模块组装 (Module Assembly)

`titan` 模块不是一个静态的 `root.zig`，而是动态组装的：

1.  **用户模块**: 用户的 `main.zig` 导入 `titan`。
2.  **Titan 模块**: 映射到 `src/include/titan.zig`。
3.  **内部连线**:
    *   `src/include/titan.zig` 将在内部 `@import("arch_backend")`。
    *   `build.zig` 根据 `-Dtarget_chain` 命令行参数，将逻辑模块名 `arch_backend` 映射到物理路径（如 `src/arch/sbf/mod.zig`）。

### 3.3 链接器脚本与编译标志

*   **Solana**:
    *   目标 (Target): `bpfel-freestanding-none` (如果使用自定义 zig 可用 `sbf-solana-solana`)。
    *   链接器: 可能需要特定的 `.ld` 脚本来布局内存段。
    *   标志: `-fno-sanitize=all` (SBF 通常需要禁用部分安全检查以减小体积)。

*   **Wasm**:
    *   目标 (Target): `wasm32-freestanding`。
    *   标志: `--export-dynamic`, `--initial-memory=...`。

## 4. 实施步骤

1.  **脚手架**: 创建第 2 节定义的文件夹结构。
2.  **架构桩代码**: 为 `arch/sbf` 和 `arch/wasm` 创建最小化的 `entrypoint.zig`。
3.  **构建逻辑**: 重写 `build.zig` 以接受 `target_chain` 并切换编译目标。
4.  **验证**: 验证 `titan.zig` 能否成功编译两个目标的空项目。