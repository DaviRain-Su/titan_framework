# 工作单元 001: 内核引导 (Kernel Bootstrap)

## 上下文
作为 **Titan OS** 的第一步，我们需要一个能够同时瞄准 Solana (SBF) 和 WebAssembly (WASM) 的构建系统。这一基础使我们能够为不同的区块链环境编写统一的 Zig 代码。

## 目标
- [ ] 建立内核空间和用户空间的目录结构。
- [ ] 配置 `build.zig` 以支持 `solana` 和 `wasm` 目标。
- [ ] 创建最小的 `titan.zig` API。

## 设计
项目将分为：
- `src/titan.zig`: 用户应用的公开 API。
- `src/kernel/`: 不同链的内部实现。
- `src/user/`: 用户应用逻辑。

## 任务
- [x] 初始设计与文档编写。
- [ ] 创建 `src/titan.zig`。
- [ ] 重构 `build.zig` 以支持 `-Dtarget_chain=[solana|near|generic]`。
- [ ] 实现用于验证的哑入口点 (Dummy Entrypoints)。

## 验证计划
- 为 Solana 构建：`./solana-zig/zig build -Dtarget_chain=solana` -> 预期产出 `titan_os.so`。
- 为 Wasm 构建：`./solana-zig/zig build -Dtarget_chain=near` -> 预期产出 `titan_os.wasm`。