// On-Chain Merkle Tree
// 链上增量 Merkle 树实现

const std = @import("std");
const sol = @import("solana_program_sdk");

/// Merkle 树深度 (支持 2^20 = 约 100 万叶子)
pub const MERKLE_DEPTH: u32 = 20;

/// Merkle 树状态
/// 存储在 Solana 账户中
pub const MerkleTreeState = struct {
    /// 当前根哈希
    root: [32]u8,
    /// 下一个叶子索引
    next_index: u32,
    /// 填充路径 (用于增量更新)
    /// 存储每层的右侧哈希值
    filled_subtrees: [MERKLE_DEPTH][32]u8,
    /// 零值缓存 (每层的空子树哈希)
    zeros: [MERKLE_DEPTH][32]u8,

    pub const SIZE: usize = 32 + 4 + 32 * MERKLE_DEPTH + 32 * MERKLE_DEPTH;

    pub fn deserialize(data: []const u8) !MerkleTreeState {
        if (data.len < SIZE) {
            return error.InvalidAccountData;
        }

        var state: MerkleTreeState = undefined;
        var offset: usize = 0;

        @memcpy(&state.root, data[offset..][0..32]);
        offset += 32;

        state.next_index = std.mem.readInt(u32, data[offset..][0..4], .little);
        offset += 4;

        for (0..MERKLE_DEPTH) |i| {
            @memcpy(&state.filled_subtrees[i], data[offset..][0..32]);
            offset += 32;
        }

        for (0..MERKLE_DEPTH) |i| {
            @memcpy(&state.zeros[i], data[offset..][0..32]);
            offset += 32;
        }

        return state;
    }

    pub fn serialize(self: *const MerkleTreeState, data: []u8) !void {
        if (data.len < SIZE) {
            return error.BufferTooSmall;
        }

        var offset: usize = 0;

        @memcpy(data[offset..][0..32], &self.root);
        offset += 32;

        std.mem.writeInt(u32, data[offset..][0..4], self.next_index, .little);
        offset += 4;

        for (0..MERKLE_DEPTH) |i| {
            @memcpy(data[offset..][0..32], &self.filled_subtrees[i]);
            offset += 32;
        }

        for (0..MERKLE_DEPTH) |i| {
            @memcpy(data[offset..][0..32], &self.zeros[i]);
            offset += 32;
        }
    }
};

/// 初始化 Merkle 树
pub fn initialize(account: sol.account.Account) !void {
    var state = MerkleTreeState{
        .root = computeEmptyRoot(),
        .next_index = 0,
        .filled_subtrees = [_][32]u8{[_]u8{0} ** 32} ** MERKLE_DEPTH,
        .zeros = computeZeros(),
    };

    // 初始化 filled_subtrees 为零值
    for (0..MERKLE_DEPTH) |i| {
        state.filled_subtrees[i] = state.zeros[i];
    }

    const data = account.data();
    try state.serialize(data);
}

/// 插入新叶子节点
pub fn insertLeaf(account: sol.account.Account, leaf: [32]u8) !u32 {
    const data = account.data();
    var state = try MerkleTreeState.deserialize(data);

    // 检查树是否已满
    const max_leaves: u32 = 1 << MERKLE_DEPTH;
    if (state.next_index >= max_leaves) {
        return error.MerkleTreeFull;
    }

    const insert_index = state.next_index;
    var current_hash = leaf;
    var current_index = insert_index;

    // 从叶子向上更新路径
    for (0..MERKLE_DEPTH) |level| {
        const is_left = (current_index & 1) == 0;

        if (is_left) {
            // 当前节点在左边，右边是零值
            // 更新 filled_subtrees
            state.filled_subtrees[level] = current_hash;
            current_hash = poseidonHash(current_hash, state.zeros[level]);
        } else {
            // 当前节点在右边，左边是 filled_subtrees
            current_hash = poseidonHash(state.filled_subtrees[level], current_hash);
        }

        current_index >>= 1;
    }

    // 更新根和索引
    state.root = current_hash;
    state.next_index = insert_index + 1;

    // 保存状态
    try state.serialize(data);

    sol.log.log("Leaf inserted into Merkle tree");
    return insert_index;
}

/// 获取当前 Merkle 根
pub fn getRoot(account: sol.account.Account) [32]u8 {
    const data = account.data();
    const state = MerkleTreeState.deserialize(data) catch {
        return [_]u8{0} ** 32;
    };
    return state.root;
}

/// 获取下一个叶子索引
pub fn getNextIndex(account: sol.account.Account) u32 {
    const data = account.data();
    const state = MerkleTreeState.deserialize(data) catch {
        return 0;
    };
    return state.next_index;
}

// ============================================================================
// Poseidon 哈希 (链上计算)
// ============================================================================

/// Poseidon 哈希 (2 个输入)
/// 注意: 实际实现需要使用预编译或完整实现
fn poseidonHash(left: [32]u8, right: [32]u8) [32]u8 {
    // TODO: 实现 Poseidon 哈希
    // 可选方案:
    // 1. 使用 Solana 的 Poseidon syscall (如果可用)
    // 2. 在链上实现 Poseidon (计算密集)
    // 3. 使用 Keccak256 作为临时替代 (不安全，仅用于开发)

    // 临时: 使用简单的 XOR (仅用于开发!)
    var result: [32]u8 = undefined;
    for (0..32) |i| {
        result[i] = left[i] ^ right[i];
    }
    return result;
}

/// 计算空树的根
fn computeEmptyRoot() [32]u8 {
    const zeros = computeZeros();
    var current = zeros[0];

    for (0..MERKLE_DEPTH) |level| {
        current = poseidonHash(current, zeros[level]);
    }

    return current;
}

/// 预计算每层的零值
fn computeZeros() [MERKLE_DEPTH][32]u8 {
    var zeros: [MERKLE_DEPTH][32]u8 = undefined;

    // 第 0 层零值 (叶子层)
    zeros[0] = [_]u8{0} ** 32;

    // 计算每层的零值
    // zeros[i] = hash(zeros[i-1], zeros[i-1])
    for (1..MERKLE_DEPTH) |i| {
        zeros[i] = poseidonHash(zeros[i - 1], zeros[i - 1]);
    }

    return zeros;
}

// ============================================================================
// 测试
// ============================================================================

test "merkle tree state serialization" {
    var state = MerkleTreeState{
        .root = [_]u8{1} ** 32,
        .next_index = 42,
        .filled_subtrees = [_][32]u8{[_]u8{2} ** 32} ** MERKLE_DEPTH,
        .zeros = [_][32]u8{[_]u8{0} ** 32} ** MERKLE_DEPTH,
    };

    var buffer: [MerkleTreeState.SIZE]u8 = undefined;
    try state.serialize(&buffer);

    const decoded = try MerkleTreeState.deserialize(&buffer);
    try std.testing.expectEqual(state.next_index, decoded.next_index);
    try std.testing.expectEqualSlices(u8, &state.root, &decoded.root);
}
