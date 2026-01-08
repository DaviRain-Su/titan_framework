# 规范 003: 构建系统设计 (Build System)

本规范定义了 `build.zig` 的行为和命令行接口 (CLI)。

## 1. 命令行接口

开发者通过标准 Zig 构建命令进行交互。

### 1.1 指定目标链
使用 `-Dtarget_chain` 选项：

```bash
# 编译为 Solana SBF (.so)
zig build -Dtarget_chain=solana

# 编译为 Near Wasm (.wasm)
zig build -Dtarget_chain=near

# 编译为通用 Wasm (.wasm)
zig build -Dtarget_chain=wasm

# 运行本地测试 (使用 Mock 内核)
zig build test
```

### 1.2 优化选项
继承 Zig 标准选项：
```bash
# ReleaseSmall (最小体积，适合区块链)
zig build -Dtarget_chain=solana -Doptimize=ReleaseSmall
```

## 2. 输出产物 (Artifacts)

构建系统必须将产物放置在 `zig-out/bin/` 目录下：

*   **Solana**: `zig-out/bin/project_name.so`
*   **Wasm**: `zig-out/bin/project_name.wasm`

## 3. 内部实现逻辑

`build.zig` 需要根据 `-Dtarget_chain` 动态调整编译目标 (Target Triple)：

*   If `solana`: Set target to `sbf-solana-solana`.
*   If `wasm/near`: Set target to `wasm32-freestanding`.

同时，需要注入 `build_options` 模块，供源码中的 `@import("build_options")` 使用。
