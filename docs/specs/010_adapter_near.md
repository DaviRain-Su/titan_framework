# 规范 010: Near 适配器规范 (Near Adapter)

本规范定义了 Titan OS 如何在底层对接 Near Protocol (Wasm) 运行时。

**设计原则**: 将 Near 宿主函数映射为统一资源/IO 语义。

## 1. 入口点与导出

Near 没有单一入口点。它要求导出具体的函数名。
Titan 的构建系统将自动把用户的 `main` 包装为默认导出，或者允许用户标记 `export fn`。

## 2. 寄存器机制 (Register Interface)

Near 使用 u64 ID 的寄存器来传递数据。Titan 内核必须封装这一层。

### 2.1 读取输入
```zig
// Titan 内部实现
fn read_input() []u8 {
    const INPUT_REG = 0;
    near_sys.input(INPUT_REG); // 把输入读到寄存器 0
    const len = near_sys.register_len(INPUT_REG);
    const buf = allocator.alloc(u8, len);
    near_sys.read_register(INPUT_REG, buf.ptr);
    return buf;
}
```

## 3. 存储适配 (Storage)

Near 原生支持 KV 存储 Trie。

*   `storage.set(k, v)` -> `near_sys.storage_write(k.len, k.ptr, v.len, v.ptr, 0)`
*   `storage.get(k)` -> `near_sys.storage_read(...)`

这比 Solana 简单得多，因为 Near 本身就是 KV 模型的。

## 4. 异步 Promise (Async)

这是最难的部分。

*   `titan.call(target, method, args)` ->
    1.  `promise_batch_create(target)`
    2.  `promise_batch_action_function_call(...)`
    3.  返回一个 `PromiseId` (u64)。

## 5. 宿主函数列表 (Host Functions)

内核必须声明 `src/arch/wasm/near.zig`：

```zig
extern "env" fn input(register_id: u64) void;
extern "env" fn register_len(register_id: u64) u64;
extern "env" fn read_register(register_id: u64, ptr: u64) void;
extern "env" fn storage_write(key_len: u64, key_ptr: u64, val_len: u64, val_ptr: u64, register_id: u64) u64;
// ... 以及其它几十个函数
```
