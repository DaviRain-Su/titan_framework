# 入门指南 (Getting Started)

欢迎来到 Titan OS！本指南将带您完成环境配置、创建第一个 Titan 智能合约，并将其编译到不同的区块链平台。

**设计原则**: Titan OS 将链上能力抽象为统一资源/IO 语义，本指南以此为默认心智模型。

## 1. 环境准备 (Prerequisites)

Titan OS 依赖于 Zig 编译器。为了支持 Solana SBF 架构，我们需要一个包含 SBF 后端的定制版 Zig。

### 安装 Zig (Titan Edition)

```bash
# 在项目根目录下，确保 solana-zig 存在
# 如果不存在，请参考官方文档下载
./solana-zig/zig version
# 输出应为: 0.15.x
```

## 2. 您的第一个 Titan 合约

创建一个名为 `hello.zig` 的文件：

```zig
const std = @import("std");
const titan = @import("titan");

/// Titan OS 程序的入口点
pub fn main() !void {
    // 1. 获取内存分配器
    const allocator = titan.heap.page_allocator;

    // 2. 打印日志
    titan.log("Hello, Titan World!");

    // 3. 读取输入 (如果有)
    const input = try titan.os.read_input(allocator);
    defer allocator.free(input);

    if (input.len > 0) {
        titan.log("Received input data:");
        titan.log(input);
    }
}
```

## 3. 编译与构建 (Build)

Titan OS 使用统一的构建命令。

### 目标 A: Solana (SBF)

```bash
./solana-zig/zig build -Dtarget_chain=solana
```

*   **输出**: `zig-out/bin/titan_app.so`
*   **说明**: 这是一个符合 Solana BPF Loader 要求的共享库文件。

### 目标 B: Near / Wasm (Generic)

```bash
./solana-zig/zig build -Dtarget_chain=near
```

*   **输出**: `zig-out/bin/titan_app.wasm`
*   **说明**: 这是一个标准的 WebAssembly 模块，导出了 Near 运行时所需的接口。

## 4. 本地测试 (Local Testing)

在部署到真实网络之前，您可以使用 Titan 的 Mock Runtime 进行快速单元测试。

```bash
./solana-zig/zig build test
```

## 5. 下一步

*   阅读 [用户 API 规范](../specs/001_user_api.md) 了解更多功能。
*   查看 `examples/` 目录下的完整示例代码。
