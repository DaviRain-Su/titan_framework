// Nullifier Set - 防止双花
// 使用 Solana 账户存储已使用的 nullifier

const std = @import("std");
const sol = @import("solana_program_sdk");

/// Nullifier 集合头部
/// 使用 Bloom Filter + 溢出列表的混合方案
pub const NullifierSetHeader = struct {
    /// 是否已初始化
    is_initialized: bool,
    /// 已使用的 nullifier 数量
    count: u32,
    /// Bloom filter 大小 (bits)
    bloom_size: u32,
    /// 哈希函数数量 (用于 Bloom filter)
    num_hashes: u8,

    pub const SIZE: usize = 1 + 4 + 4 + 1;

    pub fn deserialize(data: []const u8) !NullifierSetHeader {
        if (data.len < SIZE) {
            return error.InvalidAccountData;
        }
        return NullifierSetHeader{
            .is_initialized = data[0] != 0,
            .count = std.mem.readInt(u32, data[1..5], .little),
            .bloom_size = std.mem.readInt(u32, data[5..9], .little),
            .num_hashes = data[9],
        };
    }

    pub fn serialize(self: *const NullifierSetHeader, data: []u8) !void {
        if (data.len < SIZE) {
            return error.BufferTooSmall;
        }
        data[0] = if (self.is_initialized) 1 else 0;
        std.mem.writeInt(u32, data[1..5], self.count, .little);
        std.mem.writeInt(u32, data[5..9], self.bloom_size, .little);
        data[9] = self.num_hashes;
    }
};

/// 默认 Bloom filter 参数
/// 测试版本使用较小的 Bloom filter (1KB = 8K bits)
/// 账户大小为 4KB，需要为 header (10 bytes) 和 overflow list 留空间
/// 布局: Header(10) + Bloom(1024) + Overflow(~3K for ~95 nullifiers)
const DEFAULT_BLOOM_SIZE: u32 = 1024 * 8; // 1KB = 8K bits (for testing)
const DEFAULT_NUM_HASHES: u8 = 5;

/// 初始化 Nullifier 集合
pub fn initialize(account: sol.account.Account) !void {
    const data = account.data();

    var header = NullifierSetHeader{
        .is_initialized = true,
        .count = 0,
        .bloom_size = DEFAULT_BLOOM_SIZE,
        .num_hashes = DEFAULT_NUM_HASHES,
    };

    try header.serialize(data);

    // 清零 Bloom filter 区域
    const bloom_start = NullifierSetHeader.SIZE;
    const bloom_bytes = header.bloom_size / 8;

    if (data.len > bloom_start) {
        const bloom_data = data[bloom_start..];
        const clear_len = @min(bloom_data.len, bloom_bytes);
        @memset(bloom_data[0..clear_len], 0);
    }

    sol.log.log("Nullifier set initialized");
}

/// 检查 nullifier 是否已存在
pub fn contains(account: sol.account.Account, nullifier: [32]u8) bool {
    const data = account.data();

    const header = NullifierSetHeader.deserialize(data) catch {
        return false;
    };

    if (!header.is_initialized) {
        return false;
    }

    // 检查 Bloom filter
    const bloom_start = NullifierSetHeader.SIZE;
    if (data.len <= bloom_start) {
        return false;
    }

    const bloom_data = data[bloom_start..];
    const bloom_bits = header.bloom_size;

    // 计算所有哈希位置并检查
    for (0..header.num_hashes) |i| {
        const bit_index = computeBloomIndex(nullifier, @intCast(i), bloom_bits);
        const byte_index = bit_index / 8;
        const bit_offset: u3 = @intCast(bit_index % 8);

        if (byte_index >= bloom_data.len) {
            continue;
        }

        if ((bloom_data[byte_index] & (@as(u8, 1) << bit_offset)) == 0) {
            // 如果任何一个位为 0，则肯定不存在
            return false;
        }
    }

    // Bloom filter 显示可能存在
    // 在生产环境中，这里应该检查溢出列表以确认
    // 由于 Bloom filter 有假阳性，需要精确检查
    return checkOverflowList(data, header, nullifier);
}

/// 插入 nullifier
pub fn insert(account: sol.account.Account, nullifier: [32]u8) !void {
    const data = account.data();

    var header = try NullifierSetHeader.deserialize(data);

    if (!header.is_initialized) {
        return error.InvalidAccountData;
    }

    // 首先检查是否已存在
    if (contains(account, nullifier)) {
        return error.NullifierAlreadyUsed;
    }

    // 更新 Bloom filter
    const bloom_start = NullifierSetHeader.SIZE;
    if (data.len <= bloom_start) {
        return error.InvalidAccountData;
    }

    const bloom_data = data[bloom_start..];
    const bloom_bits = header.bloom_size;

    for (0..header.num_hashes) |i| {
        const bit_index = computeBloomIndex(nullifier, @intCast(i), bloom_bits);
        const byte_index = bit_index / 8;
        const bit_offset: u3 = @intCast(bit_index % 8);

        if (byte_index < bloom_data.len) {
            bloom_data[byte_index] |= (@as(u8, 1) << bit_offset);
        }
    }

    // 添加到溢出列表 (用于精确查找)
    try addToOverflowList(data, header, nullifier);

    // 更新计数
    header.count += 1;
    try header.serialize(data);

    sol.log.log("Nullifier inserted");
}

// ============================================================================
// 辅助函数
// ============================================================================

/// 计算 Bloom filter 的位索引
fn computeBloomIndex(nullifier: [32]u8, hash_index: u8, bloom_bits: u32) u32 {
    // 使用简单的双哈希方案: h(i) = h1 + i * h2
    // 其中 h1 和 h2 从 nullifier 派生

    // h1 = 前 8 字节
    const h1 = std.mem.readInt(u64, nullifier[0..8], .little);
    // h2 = 后 8 字节
    const h2 = std.mem.readInt(u64, nullifier[8..16], .little);

    const combined = h1 +% (@as(u64, hash_index) *% h2);
    return @truncate(combined % bloom_bits);
}

/// 检查溢出列表
fn checkOverflowList(data: []const u8, header: NullifierSetHeader, nullifier: [32]u8) bool {
    // 溢出列表位于 Bloom filter 之后
    const bloom_bytes = header.bloom_size / 8;
    const overflow_start = NullifierSetHeader.SIZE + bloom_bytes;

    if (data.len <= overflow_start) {
        return false;
    }

    const overflow_data = data[overflow_start..];
    const entry_count = header.count;

    // 遍历溢出列表查找精确匹配
    var i: u32 = 0;
    while (i < entry_count) : (i += 1) {
        const offset = i * 32;
        if (offset + 32 > overflow_data.len) {
            break;
        }

        if (std.mem.eql(u8, overflow_data[offset..][0..32], &nullifier)) {
            return true;
        }
    }

    return false;
}

/// 添加到溢出列表
fn addToOverflowList(data: []u8, header: NullifierSetHeader, nullifier: [32]u8) !void {
    const bloom_bytes = header.bloom_size / 8;
    const overflow_start = NullifierSetHeader.SIZE + bloom_bytes;

    if (data.len <= overflow_start) {
        return error.InvalidAccountData;
    }

    const overflow_data = data[overflow_start..];
    const offset = header.count * 32;

    if (offset + 32 > overflow_data.len) {
        return error.NullifierSetFull;
    }

    @memcpy(overflow_data[offset..][0..32], &nullifier);
}

// ============================================================================
// 测试
// ============================================================================

test "nullifier set header serialization" {
    var header = NullifierSetHeader{
        .is_initialized = true,
        .count = 100,
        .bloom_size = 8192,
        .num_hashes = 5,
    };

    var buffer: [NullifierSetHeader.SIZE]u8 = undefined;
    try header.serialize(&buffer);

    const decoded = try NullifierSetHeader.deserialize(&buffer);
    try std.testing.expect(decoded.is_initialized);
    try std.testing.expectEqual(header.count, decoded.count);
    try std.testing.expectEqual(header.bloom_size, decoded.bloom_size);
}

test "bloom index computation" {
    const nullifier = [_]u8{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16} ++ [_]u8{0} ** 16;
    const bloom_bits: u32 = 1024 * 8;

    // 不同的 hash_index 应该产生不同的结果
    const idx0 = computeBloomIndex(nullifier, 0, bloom_bits);
    const idx1 = computeBloomIndex(nullifier, 1, bloom_bits);
    const idx2 = computeBloomIndex(nullifier, 2, bloom_bits);

    try std.testing.expect(idx0 != idx1);
    try std.testing.expect(idx1 != idx2);

    // 所有索引应该在范围内
    try std.testing.expect(idx0 < bloom_bits);
    try std.testing.expect(idx1 < bloom_bits);
    try std.testing.expect(idx2 < bloom_bits);
}
