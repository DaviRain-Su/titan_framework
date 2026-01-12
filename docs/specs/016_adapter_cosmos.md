# 规范 016: Cosmos 适配器规范 (CosmWasm Adapter)

本规范定义了 Titan OS 如何在底层对接 Cosmos 生态的 CosmWasm 智能合约运行时。

**设计原则**: 将 CosmWasm 的 Actor/Message 模型映射为统一资源/IO 语义。

> **状态**: 规划中 (V2 Target)
> **依赖**: [018_multichain_storage.md](018_multichain_storage.md) (存储层实现)

## 1. 架构映射策略

CosmWasm 采用 Actor Model，每个合约是一个独立的 Actor，通过消息进行通信。

| Titan 概念 | CosmWasm 概念 | 适配策略 |
| :--- | :--- | :--- |
| **Contract** | **Actor** | 每个 Titan 合约映射为一个 CosmWasm 合约 |
| **Entrypoint** | **Entry Points** | `main` 映射为 `instantiate`/`execute`/`query` |
| **Message** | **Msg Enum** | Zig struct 映射为 JSON 消息 |
| **Storage** | **Storage (deps.storage)** | 直接映射到 KV 存储 (见 018) |
| **Call** | **SubMsg/WasmMsg** | `titan.call` 映射为 CosmWasm 子消息 |

## 2. 入口点映射 (Entry Points)

CosmWasm 合约必须导出三个核心入口点。Titan 编译器将自动生成这些 Wasm 导出函数。

### 2.1 入口点定义

```zig
// 用户代码 (Titan)
pub const Contract = struct {
    // 初始化 (仅调用一次)
    pub fn instantiate(ctx: *Context, msg: InstantiateMsg) !Response {
        // ...
    }

    // 状态变更操作
    pub fn execute(ctx: *Context, msg: ExecuteMsg) !Response {
        // ...
    }

    // 只读查询
    pub fn query(ctx: *Context, msg: QueryMsg) ![]const u8 {
        // ...
    }
};
```

### 2.2 Wasm 导出函数签名

Titan 编译器生成的 Wasm 导出：

```zig
// 自动生成 (arch/wasm/cosmwasm.zig)

/// CosmWasm instantiate 入口
export fn instantiate(env_ptr: u32, info_ptr: u32, msg_ptr: u32) u32 {
    // 1. 从 Region 指针读取数据
    const env = readRegion(Env, env_ptr);
    const info = readRegion(MessageInfo, info_ptr);
    const msg_bytes = readRegionBytes(msg_ptr);

    // 2. JSON 反序列化
    const msg = titan.serde.json.parse(InstantiateMsg, msg_bytes);

    // 3. 构建 Context
    var ctx = Context.init(env, info);

    // 4. 调用用户逻辑
    const response = Contract.instantiate(&ctx, msg) catch |err| {
        return writeErrorResponse(err);
    };

    // 5. 序列化响应
    return writeResponse(response);
}

/// CosmWasm execute 入口
export fn execute(env_ptr: u32, info_ptr: u32, msg_ptr: u32) u32 {
    // 类似 instantiate，但调用 Contract.execute
}

/// CosmWasm query 入口 (只读，无 info)
export fn query(env_ptr: u32, msg_ptr: u32) u32 {
    // 无 MessageInfo，直接返回查询结果
}
```

### 2.3 Region 内存布局

CosmWasm 使用 `Region` 结构在 Wasm 线性内存中传递数据：

```zig
/// CosmWasm Region 结构
pub const Region = extern struct {
    /// 数据起始偏移 (在 Wasm 线性内存中)
    offset: u32,
    /// 已分配容量
    capacity: u32,
    /// 实际数据长度
    length: u32,
};

/// 从 Region 指针读取数据
fn readRegionBytes(region_ptr: u32) []const u8 {
    const region: *const Region = @ptrFromInt(region_ptr);
    const data_ptr: [*]const u8 = @ptrFromInt(region.offset);
    return data_ptr[0..region.length];
}

/// 分配 Region 并写入数据
fn allocateRegion(data: []const u8) u32 {
    const region = allocator.create(Region);
    const buffer = allocator.alloc(u8, data.len);
    @memcpy(buffer, data);

    region.* = .{
        .offset = @intFromPtr(buffer.ptr),
        .capacity = @intCast(data.len),
        .length = @intCast(data.len),
    };

    return @intFromPtr(region);
}
```

## 3. 上下文结构 (Context)

### 3.1 CosmWasm 环境信息

```zig
/// CosmWasm 环境 (由宿主提供)
pub const Env = struct {
    block: BlockInfo,
    transaction: ?TransactionInfo,
    contract: ContractInfo,
};

pub const BlockInfo = struct {
    height: u64,
    time: u64,        // Unix 纳秒时间戳
    chain_id: []const u8,
};

pub const ContractInfo = struct {
    address: Address, // Bech32 地址
};

/// 消息发送者信息
pub const MessageInfo = struct {
    sender: Address,
    funds: []Coin,    // 附带的原生代币
};

pub const Coin = struct {
    denom: []const u8,
    amount: u128,
};
```

### 3.2 Titan Context 封装

```zig
pub const Context = struct {
    env: Env,
    info: ?MessageInfo,  // query 时为 null
    storage: Storage,

    /// 当前区块高度
    pub fn blockHeight(self: *const Context) u64 {
        return self.env.block.height;
    }

    /// 当前区块时间 (秒)
    pub fn blockTime(self: *const Context) u64 {
        return self.env.block.time / 1_000_000_000;
    }

    /// 消息发送者
    pub fn sender(self: *const Context) Address {
        return self.info.?.sender;
    }

    /// 合约地址
    pub fn contractAddress(self: *const Context) Address {
        return self.env.contract.address;
    }
};
```

## 4. 消息与响应 (Messages & Responses)

### 4.1 消息定义

CosmWasm 使用 JSON 作为消息格式。Titan 支持两种模式：

**模式 A: 单一结构体 (推荐)**
```zig
pub const ExecuteMsg = union(enum) {
    transfer: TransferArgs,
    approve: ApproveArgs,
    burn: BurnArgs,
};

pub const TransferArgs = struct {
    recipient: Address,
    amount: u128,
};
```

**生成的 JSON Schema:**
```json
{
  "transfer": { "recipient": "cosmos1...", "amount": "1000000" }
}
```

**模式 B: 带 Discriminator (兼容模式)**
```zig
pub const ExecuteMsg = struct {
    @"type": []const u8,  // "transfer", "approve", "burn"
    data: []const u8,     // 嵌套 JSON
};
```

### 4.2 响应结构

```zig
pub const Response = struct {
    /// 子消息 (异步调用其他合约)
    messages: []SubMsg = &.{},
    /// 属性 (用于索引)
    attributes: []Attribute = &.{},
    /// 事件
    events: []Event = &.{},
    /// 返回数据
    data: ?[]const u8 = null,

    pub fn new() Response {
        return .{};
    }

    pub fn addMessage(self: *Response, msg: CosmosMsg) void {
        // 添加子消息
    }

    pub fn addAttribute(self: *Response, key: []const u8, value: []const u8) void {
        // 添加属性
    }
};

pub const Attribute = struct {
    key: []const u8,
    value: []const u8,
};
```

## 5. 宿主函数映射 (Host Functions)

### 5.1 核心宿主函数

```zig
// arch/wasm/cosmwasm_imports.zig

// ===== 存储 =====
extern "env" fn db_read(key: u32) u32;           // 返回 Region ptr 或 0
extern "env" fn db_write(key: u32, value: u32) void;
extern "env" fn db_remove(key: u32) void;

// ===== 迭代器 =====
extern "env" fn db_scan(start: u32, end: u32, order: i32) u32;  // 返回 iterator_id
extern "env" fn db_next(iterator_id: u32) u32;                   // 返回 Region ptr

// ===== 地址验证 =====
extern "env" fn addr_validate(source: u32) u32;
extern "env" fn addr_canonicalize(source: u32, dest: u32) u32;
extern "env" fn addr_humanize(source: u32, dest: u32) u32;

// ===== 加密 =====
extern "env" fn secp256k1_verify(hash: u32, sig: u32, pubkey: u32) u32;
extern "env" fn secp256k1_recover_pubkey(hash: u32, sig: u32, param: u32) u64;
extern "env" fn ed25519_verify(msg: u32, sig: u32, pubkey: u32) u32;
extern "env" fn ed25519_batch_verify(msgs: u32, sigs: u32, pubkeys: u32) u32;

// ===== 调试 =====
extern "env" fn debug(source: u32) void;
extern "env" fn abort(source: u32) void;

// ===== 查询 =====
extern "env" fn query_chain(request: u32) u32;  // 查询其他模块/合约
```

### 5.2 Titan API 映射

| Titan API | CosmWasm Host Function | 说明 |
| :--- | :--- | :--- |
| `titan.log(msg)` | `debug(region_ptr)` | 调试日志 |
| `titan.storage.get(k)` | `db_read(k_region)` | 读取存储 |
| `titan.storage.set(k, v)` | `db_write(k_region, v_region)` | 写入存储 |
| `titan.crypto.verify_sig(...)` | `secp256k1_verify(...)` | 签名验证 |
| `titan.address.validate(addr)` | `addr_validate(region)` | 地址验证 |

## 6. 跨合约调用 (Cross-Contract Calls)

### 6.1 同步查询

```zig
/// 查询其他合约
pub fn queryContract(
    contract_addr: Address,
    msg: anytype,
) ![]const u8 {
    const request = QueryRequest{
        .wasm = .{
            .smart = .{
                .contract_addr = contract_addr,
                .msg = titan.serde.json.stringify(msg),
            },
        },
    };

    const request_bytes = titan.serde.json.stringify(request);
    const region = allocateRegion(request_bytes);
    const result_ptr = query_chain(region);

    if (result_ptr == 0) return error.QueryFailed;
    return readRegionBytes(result_ptr);
}
```

### 6.2 异步执行 (SubMsg)

```zig
/// 调用其他合约 (异步)
pub fn callContract(
    response: *Response,
    contract_addr: Address,
    msg: anytype,
    funds: []const Coin,
) void {
    const wasm_msg = CosmosMsg{
        .wasm = .{
            .execute = .{
                .contract_addr = contract_addr,
                .msg = titan.serde.json.stringify(msg),
                .funds = funds,
            },
        },
    };

    response.addMessage(SubMsg{
        .id = 0,  // 无需回调
        .msg = wasm_msg,
        .reply_on = .never,
    });
}
```

### 6.3 带回调的调用 (Reply)

```zig
/// 调用并处理回调
pub fn callWithReply(
    response: *Response,
    id: u64,
    contract_addr: Address,
    msg: anytype,
) void {
    response.addMessage(SubMsg{
        .id = id,
        .msg = wasmExecute(contract_addr, msg, &.{}),
        .reply_on = .success,  // 或 .error, .always
    });
}

// 用户需要实现 reply 入口点
pub fn reply(ctx: *Context, msg: Reply) !Response {
    switch (msg.id) {
        1 => {
            // 处理调用结果
            const data = msg.result.unwrap();
            // ...
        },
        else => return error.UnknownReplyId,
    }
}
```

## 7. IBC 支持 (跨链通信)

### 7.1 IBC 入口点

IBC 合约需要额外的入口点：

```zig
pub const IbcContract = struct {
    // 标准入口点
    pub fn instantiate(...) !Response { ... }
    pub fn execute(...) !Response { ... }
    pub fn query(...) ![]const u8 { ... }

    // IBC 入口点
    pub fn ibc_channel_open(ctx: *Context, msg: IbcChannelOpenMsg) !IbcChannelOpenResponse {
        // 验证 channel 参数
    }

    pub fn ibc_channel_connect(ctx: *Context, msg: IbcChannelConnectMsg) !IbcBasicResponse {
        // Channel 建立成功
    }

    pub fn ibc_channel_close(ctx: *Context, msg: IbcChannelCloseMsg) !IbcBasicResponse {
        // Channel 关闭
    }

    pub fn ibc_packet_receive(ctx: *Context, msg: IbcPacketReceiveMsg) !IbcReceiveResponse {
        // 接收跨链数据包
    }

    pub fn ibc_packet_ack(ctx: *Context, msg: IbcPacketAckMsg) !IbcBasicResponse {
        // 收到确认
    }

    pub fn ibc_packet_timeout(ctx: *Context, msg: IbcPacketTimeoutMsg) !IbcBasicResponse {
        // 超时处理
    }
};
```

### 7.2 发送 IBC 消息

```zig
pub fn sendIbcPacket(
    response: *Response,
    channel_id: []const u8,
    data: []const u8,
    timeout: IbcTimeout,
) void {
    response.addMessage(CosmosMsg{
        .ibc = .{
            .send_packet = .{
                .channel_id = channel_id,
                .data = data,
                .timeout = timeout,
            },
        },
    });
}
```

## 8. 序列化策略

### 8.1 JSON (对外接口)

CosmWasm 标准使用 JSON。Titan 提供 `titan.serde.json` 模块：

```zig
const json = titan.serde.json;

// 序列化
const bytes = try json.stringify(MyStruct{ .field = 123 });
// -> {"field":123}

// 反序列化
const value = try json.parse(MyStruct, bytes);
```

### 8.2 特殊类型处理

| Zig 类型 | JSON 表示 | 说明 |
| :--- | :--- | :--- |
| `u128` | `"1234567890"` | 字符串 (避免精度丢失) |
| `Address` | `"cosmos1..."` | Bech32 字符串 |
| `[]u8` | `"base64..."` | Base64 编码 |
| `?T` | `null` / `{...}` | 可选类型 |

## 9. 完整示例: CW20 Token

```zig
const titan = @import("titan");
const Context = titan.cosmwasm.Context;
const Response = titan.cosmwasm.Response;
const Address = titan.Address;

// ===== 消息定义 =====

pub const InstantiateMsg = struct {
    name: []const u8,
    symbol: []const u8,
    decimals: u8,
    initial_balances: []Balance,
};

pub const Balance = struct {
    address: Address,
    amount: u128,
};

pub const ExecuteMsg = union(enum) {
    transfer: TransferMsg,
    burn: BurnMsg,
};

pub const TransferMsg = struct {
    recipient: Address,
    amount: u128,
};

pub const BurnMsg = struct {
    amount: u128,
};

pub const QueryMsg = union(enum) {
    balance: BalanceQuery,
    token_info: void,
};

pub const BalanceQuery = struct {
    address: Address,
};

// ===== 状态 =====

const BALANCES_PREFIX = "balances";
const TOKEN_INFO_KEY = "token_info";

// ===== 合约逻辑 =====

pub const Contract = struct {
    pub fn instantiate(ctx: *Context, msg: InstantiateMsg) !Response {
        // 保存 token info
        try ctx.storage.set(TOKEN_INFO_KEY, .{
            .name = msg.name,
            .symbol = msg.symbol,
            .decimals = msg.decimals,
        });

        // 设置初始余额
        for (msg.initial_balances) |balance| {
            const key = balanceKey(balance.address);
            try ctx.storage.set(key, balance.amount);
        }

        return Response.new()
            .addAttribute("action", "instantiate")
            .addAttribute("name", msg.name);
    }

    pub fn execute(ctx: *Context, msg: ExecuteMsg) !Response {
        return switch (msg) {
            .transfer => |t| transfer(ctx, t),
            .burn => |b| burn(ctx, b),
        };
    }

    pub fn query(ctx: *Context, msg: QueryMsg) ![]const u8 {
        return switch (msg) {
            .balance => |q| queryBalance(ctx, q),
            .token_info => queryTokenInfo(ctx),
        };
    }

    fn transfer(ctx: *Context, msg: TransferMsg) !Response {
        const sender = ctx.sender();

        // 扣除发送者余额
        const sender_balance = ctx.storage.get(u128, balanceKey(sender)) orelse 0;
        if (sender_balance < msg.amount) return error.InsufficientFunds;
        try ctx.storage.set(balanceKey(sender), sender_balance - msg.amount);

        // 增加接收者余额
        const recipient_balance = ctx.storage.get(u128, balanceKey(msg.recipient)) orelse 0;
        try ctx.storage.set(balanceKey(msg.recipient), recipient_balance + msg.amount);

        return Response.new()
            .addAttribute("action", "transfer")
            .addAttribute("from", sender.toString())
            .addAttribute("to", msg.recipient.toString())
            .addAttribute("amount", msg.amount);
    }

    fn burn(ctx: *Context, msg: BurnMsg) !Response {
        const sender = ctx.sender();
        const balance = ctx.storage.get(u128, balanceKey(sender)) orelse 0;

        if (balance < msg.amount) return error.InsufficientFunds;
        try ctx.storage.set(balanceKey(sender), balance - msg.amount);

        return Response.new()
            .addAttribute("action", "burn")
            .addAttribute("amount", msg.amount);
    }

    fn queryBalance(ctx: *Context, query: BalanceQuery) ![]const u8 {
        const balance = ctx.storage.get(u128, balanceKey(query.address)) orelse 0;
        return titan.serde.json.stringify(.{ .balance = balance });
    }

    fn queryTokenInfo(ctx: *Context) ![]const u8 {
        const info = ctx.storage.get(TokenInfo, TOKEN_INFO_KEY);
        return titan.serde.json.stringify(info);
    }

    fn balanceKey(addr: Address) []const u8 {
        return BALANCES_PREFIX ++ addr.toBytes();
    }
};
```

## 10. 构建配置

### 10.1 编译目标

```bash
# 编译为 CosmWasm Wasm
zig build -Dtarget_chain=cosmwasm

# 输出: zig-out/lib/contract.wasm
```

### 10.2 Wasm 优化

CosmWasm 对 Wasm 大小敏感（影响 Gas）：

```bash
# 使用 wasm-opt 优化
wasm-opt -Oz contract.wasm -o contract_optimized.wasm

# 使用 cosmwasm-check 验证
cosmwasm-check contract_optimized.wasm
```

## 11. 与 Near 适配器的差异

| 方面 | CosmWasm | Near |
| :--- | :--- | :--- |
| **入口点** | 多入口 (instantiate/execute/query) | 多导出函数 |
| **序列化** | JSON (标准) | JSON 或 Borsh |
| **数据传递** | Region 指针 | Register ID |
| **异步调用** | SubMsg + Reply | Promise Chain |
| **跨链** | IBC (原生支持) | 需要桥接 |

## 12. 限制与边界

1. **Wasm 限制**: CosmWasm 对 Wasm 有严格限制（无浮点、无 SIMD 等）
2. **Gas 模型**: 每个宿主函数调用都有 Gas 成本，需要优化
3. **存储成本**: 存储按字节计费，大数据结构需谨慎
4. **JSON 开销**: JSON 序列化比 Borsh 慢，但跨链兼容性更好

## 13. 结论

CosmWasm 适配器将 Titan 的统一 API 映射到 Cosmos 生态的 Actor Model。通过这层抽象，开发者可以用相同的 Zig 代码部署到 Osmosis、Neutron、Sei 等几十条 Cosmos 应用链。
