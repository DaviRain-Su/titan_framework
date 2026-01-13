// CLI Utilities Module Index
// 工具模块索引

pub const crypto = @import("utils/crypto.zig");
pub const storage = @import("utils/storage.zig");
pub const prover = @import("utils/prover.zig");
pub const rpc = @import("utils/rpc.zig");

// Re-export common types
pub const FieldElement = crypto.FieldElement;
pub const Commitment = crypto.Commitment;
pub const Utxo = storage.Utxo;
pub const UtxoStorage = storage.UtxoStorage;
pub const RpcClient = rpc.RpcClient;
pub const RelayerClient = rpc.RelayerClient;

test "utils: all modules compile" {
    _ = crypto;
    _ = storage;
    _ = prover;
    _ = rpc;
}
