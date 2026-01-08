# Feature 003: 基础分配器 V1 (Basic Allocator)

> 状态: 待实现
> 所属 Story: [001-内核引导](../../stories/001-kernel-bootstrap.md)

## 1. 背景与目标
Zig 标准库的 `std.heap.page_allocator` 依赖于操作系统的 `mmap`，这在区块链上是不存在的。我们需要实现符合 `std.mem.Allocator` 接口的自定义分配器，分别映射到 SBF 的 Heap 和 Wasm 的 Linear Memory。

## 2. API 设计 (Public API)

用户通过 `titan.heap` 访问分配器：

```zig
// 获取全局页分配器
const allocator = titan.heap.page_allocator;

// 使用示例
const list = std.ArrayList(u8).init(allocator);
```

## 3. 实现细节

### 3.1 目录结构
```text
src/mm/
├── allocator.zig   # 统一接口
└── impl.zig        # 路由到 arch 实现

src/arch/sbf/mm.zig # Solana 实现
src/arch/wasm/mm.zig # Wasm 实现
```

### 3.2 Solana 实现 (`BumpAllocator`)
Solana 的堆内存是预分配的一块固定区域（32KB）。最简单的实现是 **Bump Pointer (线性递增)**。

*   **特点**: 分配极快 (`ptr += size`)，但无法释放（`free` 是空操作）。
*   **适用性**: 智能合约通常是短生命周期的，这种策略完全可行。

```zig
var heap_start: [*]u8 = undefined;
var heap_pos: usize = 0;

fn alloc(ctx: *anyopaque, n: usize, alignment: u8, ra: usize) ?[*]u8 {
    // 简单的指针递增逻辑
}
```

### 3.3 Wasm 实现 (`LinearMemoryAllocator`)
使用 `memory.grow` 指令动态扩展内存。

*   **逻辑**: 维护一个 `free_list` 或直接使用 `std.heap.WasmAllocator` (如果 Zig std 已包含)。为简单起见，V1 版同样可以使用 Bump Pointer，配合 `memory.grow`。

## 4. 测试计划
*   [ ] **单元测试 (Mock)**: 在本地 `zig test` 中模拟一块内存区域，验证 Bump Allocator 的逻辑正确性。
*   [ ] **集成测试**: 在 SBF 中分配一个 `ArrayList` 并打印其长度，验证不崩溃。

## 5. 变更日志预览

### Added
- [MM] 实现 `TitanAllocator` 接口。
- [Arch/SBF] 实现基于 Bump Pointer 的堆分配器。
- [Arch/Wasm] 实现基于 Linear Memory 的分配器。
