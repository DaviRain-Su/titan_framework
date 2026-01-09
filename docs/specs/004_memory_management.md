# 规范 004: 内存管理 (Memory Management)

本规范定义了 Titan OS 如何在不同区块链架构上统一管理内存。目标是提供**安全、确定性且零开销**的内存分配接口。

**设计原则**: 内存也被视为系统资源，必须通过显式 IO/Allocator 语义访问。

## 1. 核心理念

*   **显式分配**: 禁止任何隐式内存分配。所有需要内存的函数必须接受 `Allocator` 参数。
*   **无垃圾回收 (No GC)**: Titan OS 均采用手动内存管理 (RAII 模式)。
*   **失败即崩溃 (Fail-Fast)**: 内存分配失败 (OOM) 是一级错误，通常会导致交易回滚。

## 2. 分配器接口 (Allocator Interface)

Titan OS 在内核层暴露标准的 `std.mem.Allocator` 接口，但在底层实现上有所不同。

### 2.1 全局系统分配器 (`titan.heap.page_allocator`)

这是一个单例分配器，直接映射到底层 VM 的原生能力。

*   **Solana (SBF)**:
    *   映射到 SBF 的堆空间 (Heap)。
    *   大小限制: 默认 32KB (极小)。
    *   实现: 调用 `sol_alloc_free_` (如果可用) 或实现简单的 Bump Pointer 分配器。
    *   **注意**: 由于堆极小，推荐优先使用栈内存 (Stack) 或直接操作缓冲区。

*   **WebAssembly (Wasm)**:
    *   映射到 Wasm 线性内存 (Linear Memory)。
    *   实现: 维护一个全局指针 `__heap_base`，通过 `memory.grow` 指令动态扩展内存。
    *   大小限制: 通常几 MB，相对宽裕。

### 2.2 临时区域分配器 (`titan.heap.ArenaAllocator`)

为了简化内存释放，Titan 推荐使用 Arena 模式。

```zig
pub fn main() !void {
    // 初始化 Arena，底层使用系统分配器
    var arena = std.heap.ArenaAllocator.init(titan.heap.page_allocator);
    defer arena.deinit(); // 交易结束时一次性释放所有内存
    
    const allocator = arena.allocator();
    // 后续所有分配都使用这个 allocator
}
```

## 3. 切片与指针 (Slices & Pointers)

*   **安全性**: 所有的指针访问都经过边界检查 (Bounds Checking)，除非在 ReleaseFast 模式下显式禁用。
*   **零拷贝**: 在可能的情况下，`read_input` 等 I/O 函数应返回切片 (Slice) 而不是拷贝数据。
    *   在 Solana 上，输入数据通过内存映射直接访问，无需拷贝。
    *   在 Wasm 上，可能需要一次拷贝到线性内存。

## 4. 低级内存操作 (`mm/`)

内核模块 `mm/` 将提供以下原语：

```zig
/// 获取当前堆顶指针
pub fn heap_top() [*]u8;

/// 将堆顶向上移动 `delta` 字节 (类似 sbrk)
/// 如果超出限制返回 Error.OutOfMemory
pub fn heap_grow(delta: usize) ![*]u8;
```

这些原语仅供 `TitanAllocator` 内部使用，用户空间应尽量避免直接调用。

## 5. V1 Bump Allocator 实现规范 (Critical)

### 5.1 常量定义

```zig
/// Solana SBF 堆起始地址 (由 runtime 固定)
pub const HEAP_START: usize = 0x300000000;

/// V1 默认堆大小: 32KB
pub const HEAP_SIZE: usize = 32 * 1024;

/// 对齐要求: 8 字节 (满足大多数类型)
pub const ALIGNMENT: usize = 8;
```

### 5.2 状态结构

```zig
/// Bump Allocator 内部状态 (存储在堆的起始位置)
const BumpState = struct {
    /// 当前分配指针 (向高地址增长)
    pos: usize,
    /// 堆结束边界
    end: usize,
};

/// 全局状态指针 (在 entrypoint 初始化)
var state: *BumpState = undefined;
```

### 5.3 生命周期

| 阶段 | 操作 | 说明 |
| :--- | :--- | :--- |
| **初始化** | `entrypoint` 入口处调用 `bump_init()` | 设置 `pos = HEAP_START + @sizeOf(BumpState)`, `end = HEAP_START + HEAP_SIZE` |
| **分配** | `alloc(len, alignment)` | 对齐 `pos`，检查 `pos + len <= end`，返回指针并移动 `pos` |
| **释放** | `free(ptr)` | **V1 不支持单独释放**，调用为空操作 (no-op) |
| **重置** | `reset()` | 将 `pos` 重置为初始值，**仅在交易边界调用** |

### 5.4 OOM 行为

```zig
pub fn alloc(len: usize, alignment: u8) ?[*]u8 {
    const aligned_pos = std.mem.alignForward(usize, state.pos, alignment);
    const new_pos = aligned_pos + len;

    if (new_pos > state.end) {
        // OOM: 返回 null，上层转换为 Error.OutOfMemory
        return null;
    }

    state.pos = new_pos;
    return @ptrFromInt(aligned_pos);
}
```

### 5.5 不变量 (Invariants)

1. `HEAP_START <= state.pos <= state.end`
2. 所有返回的指针地址满足请求的对齐要求
3. 一次交易内的 `state.pos` 单调递增（无回退）
4. `reset()` 仅在交易结束或测试边界调用
