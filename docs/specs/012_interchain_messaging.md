# 规范 012: 跨链通信协议 (Inter-Chain Messaging)

本规范定义了 Titan OS 应用层通用的跨链通信接口。目标是让开发者像调用本地函数一样，调用另一条链上的合约。

## 1. 设计理念

Titan OS 不自己造跨链桥，而是定义一层 **"Meta-Bridge Interface" (元桥接口)**。底层适配 LayerZero, Wormhole, IBC 或 Chainlink CCIP。

## 2. 统一消息格式 (Titan Packet)

所有跨链消息都被封装在一个标准包中：

```zig
pub const TitanPacket = struct {
    src_chain: u64,      // 源链 ID (遵循 Titan Chain ID 规范)
    src_contract: Address, // 源合约地址
    dst_contract: Address, // 目标合约地址
    nonce: u64,          // 防重放 Nonce
    payload: []const u8, // 实际业务数据 (Borsh 序列化)
};
```

## 3. 发送接口 (Send API)

用户代码：

```zig
try titan.bridge.send(.{
    .target_chain = .near,
    .target_address = near_contract_addr,
    .payload = MyMessage { .op = .ping, .data = 123 },
    .provider = .layerzero, // 选择底层桥提供商
});
```

## 4. 接收接口 (Receive Interface)

Titan 内核会自动验证底层桥的签名，然后回调用户的接收函数。

```zig
pub fn on_receive(packet: TitanPacket) !void {
    if (packet.src_chain == .solana) {
        // 处理来自 Solana 的消息
    }
}
```

## 5. 底层适配 (Bridge Adapters)

Titan 标准库包含对主流桥的适配实现。

### 5.1 LayerZero 适配
*   **发送**: 调用 LayerZero Endpoint 的 `send` 函数。
*   **接收**: 实现 `lzReceive` 接口，并解析 payload 转发给 `on_receive`。

### 5.2 Wormhole 适配
*   **发送**: 调用 Wormhole Core Bridge 的 `publish_message`。
*   **接收**: 验证 VAA (Verifiable Action Approval)，解析后转发。

### 5.3 IBC 适配 (Cosmos/Near)
*   利用原生的 IBC Channel 进行通信。

## 6. 异常处理
*   **发送失败**: 本地回滚。
*   **执行失败 (目标链)**: 跨链桥通常支持 "Ack" 机制。Titan OS 将暴露 `on_ack` 回调，允许源链合约处理目标链的执行结果（成功或失败）。
