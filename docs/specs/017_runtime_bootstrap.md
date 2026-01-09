# 规范 017: 运行时引导与上下文抽象 (Runtime Bootstrap)

本规范定义了 Titan OS 如何将底层的虚拟机入口（如 Solana `entrypoint` 或 Wasm `_start`）转换为用户友好的 `main` 函数调用。这是实现“操作系统抽象”的关键环节。

## 1. 用户入口标准 (User Entrypoint Standard)

用户程序**必须且只能**定义一个 `main` 函数。禁止用户直接导出 `entrypoint`。

```zig
const titan = @import("titan");

/// 标准用户入口
/// @param ctx: 操作系统提供的上下文环境，屏蔽了底层差异
pub fn main(ctx: titan.Context) !void {
    // 业务逻辑
}
```

## 2. 内核引导流程 (Kernel Boot Process)

内核 (`src/arch/*/entrypoint.zig`) 负责实现底层的导出符号，并编排整个生命周期。

### 2.1 Solana 引导流程

```zig
// src/arch/sbf/entrypoint.zig

// 1. 导出 Solana 要求的符号
export fn entrypoint(input: [*]u8) u64 {
    // 2. 初始化内存系统 (Heap)
    mm.init_heap(0x300000000);

    // 3. 解析原始输入
    const raw = parse_sbf_input(input);

    // 4. 构建上下文 (关键：注入 KV 抽象层)
    var ctx = titan.Context.init(.{
        .sender = raw.accounts[0].key,
        .args = raw.instruction_data,
        // 传入底层句柄，但在 API 层隐藏
        ._backend_handle = raw, 
    });

    // 5. 调用用户 main
    if (root.main(ctx)) {
        return 0;
    } else |err| {
        titan.log("Execution Failed");
        return 1;
    }
}
```

## 3. 上下文抽象 (Context Abstraction)

`titan.Context` 彻底隐藏了底层存储模型的差异，仅暴露统一的 KV 接口。

```zig
pub const Context = struct {
    // === 通用属性 ===
    sender: Address,     // 交易发起者
    args: []const u8,    // 原始参数
    
    // === 统一存储接口 (KV) ===
    // 这是一个抽象接口，底层实现各异
    storage: Storage,

    // === 私有字段 (用户不可见) ===
    _backend_handle: anytype, // 存储 Solana accounts 或 Near registers

    pub fn self_address(self: Context) Address;
};

pub const Storage = struct {
    ctx: *Context,

    /// 写入数据
    /// Solana: 派生 PDA ("key") -> 写入该 PDA 账户数据
    /// Near: storage_write("key", val)
    pub fn set(self: Storage, key: []const u8, value: []const u8) !void;

    /// 读取数据
    /// Solana: 派生 PDA ("key") -> 读取该 PDA 账户数据
    /// Near: storage_read("key")
    pub fn get(self: Storage, key: []const u8, buffer: []u8) !usize;
};
```

## 4. 存储映射原理 (The KV Magic)

为了在 Solana 上实现 KV 且不牺牲性能，我们采用 **PDA 映射策略**。

*   **Key**: 映射为 PDA 的 Seed (字符串)。
*   **Value**: 映射为该 PDA 账户的 Data。

**Solana 上的限制**:
用户在发送交易时，必须显式把涉及到的 PDA 账户放入 `remaining_accounts` 列表中。
Titan 的客户端 SDK (`titan-js`) 会根据 Key 自动计算 PDA 并推入交易，这对用户是透明的。
但在合约层，Titan Kernel 会遍历 `remaining_accounts`，找到 Seed 匹配的那个账户进行读写。

## 5. 参数注入 (Argument Injection)

为了进一步简化，Titan OS 支持**自动反序列化参数**。如果用户定义了结构体参数：

```zig
pub fn main(ctx: Context, args: TransferArgs) !void
```

内核引导代码将利用 Zig 的 `typeInfo` 反射：
1.  检查 `main` 的参数类型。
2.  如果是结构体，自动调用 `Borsh.deserialize(ctx.args)`。
3.  将解析后的结构体传给 `main`。

**注意**: V1 阶段先只支持 `main(ctx: Context)`，参数解析由用户手动调用 `ctx.deserialize_args(T)`。

## 6. 结论

通过这种设计，`AccountInfo` 彻底从用户视野中消失了。用户只看到 `Context.storage.set/get`。这是真正的操作系统级抽象。