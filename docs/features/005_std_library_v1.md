# Feature 005: 基础标准库 V1 (Basic Std Lib)

> 状态: 待实现
> 所属 Story: [001-内核引导](../../stories/001-kernel-bootstrap.md)

## 1. 背景与目标
Zig 的标准库 (`std`) 非常强大，但部分功能依赖于 OS (如 `std.fs`, `std.net`)，无法在区块链环境使用。Titan 需要暴露经过筛选和优化的标准库子集，并提供区块链特有的数学工具。

## 2. API 变更 (Public API)

```zig
// 1. 集合 (Collections)
const ArrayList = titan.collections.ArrayList;

// 2. 数学 (Math)
// V1 重点支持 u64/u128 的安全运算
const safe_add = titan.math.add;
```

## 3. 实现细节

### 3.1 集合库 (`src/lib/collections/mod.zig`)
我们将复用 `std.ArrayList`，但对其进行封装，确保默认使用 `titan.heap.page_allocator`，减少用户传参的繁琐。

```zig
pub fn ArrayList(comptime T: type) type {
    return std.ArrayList(T);
}
```

### 3.2 数学库 (`src/lib/math/mod.zig`)
Zig 默认的 `+` 运算符在 ReleaseFast 下可能不检查溢出。Titan 的 `math` 模块将强制进行检查。

```zig
pub fn add(a: anytype, b: anytype) !@TypeOf(a) {
    return std.math.add(@TypeOf(a), a, b);
}
```

## 4. 依赖关系
*   依赖 **F-003 (内存分配器)** 来支持 `ArrayList`。

## 5. 测试计划
*   [ ] **单元测试**: 验证 `titan.math.add` 在溢出时返回错误。
*   [ ] **单元测试**: 验证 `titan.collections.ArrayList` 可以正常 append 和 pop。

## 6. 变更日志预览

### Added
- [Lib] 引入 `titan.collections` 模块。
- [Lib] 引入 `titan.math` 安全数学模块。
