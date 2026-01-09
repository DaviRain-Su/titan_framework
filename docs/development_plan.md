# 近期开发计划 (阶段 1: 内核)

本计划专注于实现 **阶段 1 里程碑** 的即时技术步骤：建立一个允许单个 Zig 代码库运行在 Solana 和 Wasm 上的“Titan OS”内核。

**设计原则**: 所有实现步骤需遵循 Linux “一切皆资源/IO”抽象。

## 目标
创建一个最小项目，使 `src/main.zig` (用户逻辑) 能成功编译为：
1.  **Solana SBF** (`.so`)
2.  **WebAssembly** (`.wasm`)

## 步骤 1: 项目结构设置
- [ ] 细化 `build.zig` 以明确定义两个构建目标。
- [ ] 创建目录结构：`src/kernel/solana`, `src/kernel/wasm`, `src/user`。

## 步骤 2: 定义内核接口 (Titan Core)
- [ ] 创建 `src/titan.zig` (公开 API)。
- [ ] 定义通用接口：`log(msg: []const u8)`, `exit(code: u32)`。

## 步骤 3: 实现 Solana 内核
- [ ] 实现 `src/kernel/solana/entrypoint.zig`。
- [ ] 使用内联汇编或外部定义实现 `sol_log` 封装。
- [ ] 在 `build.zig` 中实现 SBF 特有的链接器脚本或标志。

## 步骤 4: 实现 Wasm 内核 (通用)
- [ ] 实现 `src/kernel/wasm/entrypoint.zig`。
- [ ] 定义通用宿主函数导入 (例如 `env.log`)。
- [ ] 确保有效的 Wasm 模块导出结构。

## 步骤 5: “用户空间” 应用
- [ ] 编写导入 `titan` 的 `src/main.zig`。
- [ ] 调用 `titan.log("Hello Titan OS")`。

## 步骤 6: 构建与验证
- [ ] 运行 `zig build -Dtarget=solana` 并检查 `titan_framework.so`。
- [ ] 运行 `zig build -Dtarget=wasm` 并检查 `titan_framework.wasm`。
- [ ] 使用 `readelf` 或 `wasm-objdump` 检查产物并验证导入/导出。
