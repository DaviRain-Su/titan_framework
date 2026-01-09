# 规范 013: 事件与索引 (Events & Indexing)

本规范定义了 Titan OS 的统一事件日志系统。目标是让前端和索引器（Indexer）能够以统一的方式解析多链数据。

**设计原则**: 事件是写入型 IO 资源，需统一编码与索引语义。

## 1. 统一事件结构

在 Zig 中定义事件结构体：

```zig
const DepositEvent = struct {
    user: Address,
    amount: u64,
    timestamp: u64,
};
```

## 2. 发送事件 (Emit API)

```zig
titan.events.emit("Deposit", DepositEvent {
    .user = alice,
    .amount = 100,
    .timestamp = titan.os.timestamp(),
});
```

## 3. 底层映射

Titan 内核负责将上述高层事件转换为链特定的日志格式。

### 3.1 Solana (Log Instruction)
*   **格式**: base64 编码的 Borsh 数据，前缀为特定的 discriminator。
*   **指令**: `sol_log_data(&[discriminator, ...serialized_data])`。
*   **索引**: 索引器监听 `Program Logs`。

### 3.2 Near (Execution Outcome)
*   **格式**: JSON 字符串，遵循 NEP-297 标准。
*   **内容**: `EVENT_JSON:{"standard":"titan","version":"1.0.0","event":"Deposit","data":{...}}`。
*   **指令**: `env.log(json_string)`。

### 3.3 EVM (Stylus)
*   **格式**: 标准 EVM Log (Topics + Data)。
*   **指令**: `log1/log2/...`。
*   **Topic 0**: `keccak256("Deposit(address,uint64,uint64)")`。

## 4. 索引器支持 (Indexer Support)

Titan 官方将提供一个名为 `titan-graph` 的工具。
*   **输入**: Titan IDL (定义了所有 Event 结构)。
*   **输出**: Subgraph manifest (The Graph) 或 Squids (Subsquid) 配置文件。
*   **作用**: 自动生成能够同时索引 Solana、Near 和 EVM 上 Titan 合约的索引器代码。
