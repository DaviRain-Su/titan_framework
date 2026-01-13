// Cryptographic utilities for Privacy AMM CLI
// Poseidon 哈希和 commitment 生成

const std = @import("std");

/// 32 字节字段元素
pub const FieldElement = [32]u8;

/// UTXO Commitment 结构
pub const Commitment = struct {
    /// Commitment 哈希值
    hash: FieldElement,
    /// 随机盲因子
    blinding: FieldElement,
    /// 金额 (lamports)
    amount: u64,
    /// 资产 ID (mint address hash)
    asset_id: FieldElement,
    /// 拥有者公钥
    owner_pubkey: FieldElement,
};

/// 生成随机盲因子
pub fn generateBlinding() FieldElement {
    var blinding: FieldElement = undefined;
    std.crypto.random.bytes(&blinding);
    // 确保值在有效范围内 (小于 BN254 素数)
    blinding[31] &= 0x1F; // 简化处理，确保最高位合理
    return blinding;
}

/// 生成 UTXO commitment
/// commitment = poseidon(amount, asset_id, owner_pubkey, blinding)
pub fn generateCommitment(
    amount: u64,
    asset_id: FieldElement,
    owner_pubkey: FieldElement,
    blinding: FieldElement,
) Commitment {
    // 将 amount 转换为字段元素
    var amount_fe: FieldElement = [_]u8{0} ** 32;
    std.mem.writeInt(u64, amount_fe[0..8], amount, .little);

    // 计算 commitment hash
    // TODO: 实际使用 Poseidon 哈希
    // 目前使用 SHA256 作为临时替代
    const hash = computeCommitmentHash(amount_fe, asset_id, owner_pubkey, blinding);

    return Commitment{
        .hash = hash,
        .blinding = blinding,
        .amount = amount,
        .asset_id = asset_id,
        .owner_pubkey = owner_pubkey,
    };
}

/// 计算 commitment 哈希
/// 注意: 生产环境需要使用 Poseidon 哈希
fn computeCommitmentHash(
    amount: FieldElement,
    asset_id: FieldElement,
    owner: FieldElement,
    blinding: FieldElement,
) FieldElement {
    // TODO: 替换为真正的 Poseidon 实现
    // 临时使用 SHA256，仅用于开发测试
    var hasher = std.crypto.hash.sha2.Sha256.init(.{});
    hasher.update(&amount);
    hasher.update(&asset_id);
    hasher.update(&owner);
    hasher.update(&blinding);

    var result: FieldElement = undefined;
    hasher.final(&result);

    // 确保结果在有效范围内
    result[31] &= 0x1F;
    return result;
}

/// 计算 nullifier
/// nullifier = poseidon(commitment, path_index, spending_key)
pub fn computeNullifier(
    commitment: FieldElement,
    path_index: u32,
    spending_key: FieldElement,
) FieldElement {
    // TODO: 替换为真正的 Poseidon 实现
    var hasher = std.crypto.hash.sha2.Sha256.init(.{});

    hasher.update(&commitment);

    var idx_bytes: [4]u8 = undefined;
    std.mem.writeInt(u32, &idx_bytes, path_index, .little);
    hasher.update(&idx_bytes);

    hasher.update(&spending_key);

    var result: FieldElement = undefined;
    hasher.final(&result);
    result[31] &= 0x1F;
    return result;
}

/// 从 base58 字符串解析公钥
pub fn pubkeyFromBase58(base58_str: []const u8) !FieldElement {
    // 简化实现: 使用 SHA256 将任意长度输入转换为 32 字节
    // 实际实现应该正确解码 base58
    var hasher = std.crypto.hash.sha2.Sha256.init(.{});
    hasher.update(base58_str);

    var result: FieldElement = undefined;
    hasher.final(&result);
    return result;
}

/// 从代币符号获取资产 ID
pub fn assetIdFromSymbol(symbol: []const u8) FieldElement {
    // 预定义的代币资产 ID
    // 实际实现应该使用 mint address
    const well_known = [_]struct { sym: []const u8, id: FieldElement }{
        .{ .sym = "SOL", .id = [_]u8{0} ** 31 ++ [_]u8{0} },
        .{ .sym = "USDC", .id = [_]u8{0} ** 31 ++ [_]u8{1} },
        .{ .sym = "USDT", .id = [_]u8{0} ** 31 ++ [_]u8{2} },
        .{ .sym = "RAY", .id = [_]u8{0} ** 31 ++ [_]u8{3} },
    };

    for (well_known) |entry| {
        if (std.mem.eql(u8, symbol, entry.sym)) {
            return entry.id;
        }
    }

    // 未知代币: 使用符号的哈希
    var hasher = std.crypto.hash.sha2.Sha256.init(.{});
    hasher.update(symbol);

    var result: FieldElement = undefined;
    hasher.final(&result);
    result[31] &= 0x1F;
    return result;
}

/// 将字段元素转换为十六进制字符串
pub fn toHexString(fe: FieldElement, buf: *[64]u8) []const u8 {
    const hex_chars = "0123456789abcdef";
    for (fe, 0..) |byte, i| {
        buf[i * 2] = hex_chars[byte >> 4];
        buf[i * 2 + 1] = hex_chars[byte & 0x0F];
    }
    return buf[0..64];
}

/// 从十六进制字符串解析字段元素
pub fn fromHexString(hex: []const u8) !FieldElement {
    if (hex.len != 64) {
        return error.InvalidHexLength;
    }

    var result: FieldElement = undefined;
    for (0..32) |i| {
        const high = try hexCharToNibble(hex[i * 2]);
        const low = try hexCharToNibble(hex[i * 2 + 1]);
        result[i] = (@as(u8, high) << 4) | low;
    }
    return result;
}

fn hexCharToNibble(c: u8) !u4 {
    return switch (c) {
        '0'...'9' => @truncate(c - '0'),
        'a'...'f' => @truncate(c - 'a' + 10),
        'A'...'F' => @truncate(c - 'A' + 10),
        else => error.InvalidHexChar,
    };
}

// ============================================================================
// Tests
// ============================================================================

test "crypto: generate blinding" {
    const blinding1 = generateBlinding();
    const blinding2 = generateBlinding();

    // 两次生成应该不同
    try std.testing.expect(!std.mem.eql(u8, &blinding1, &blinding2));
}

test "crypto: generate commitment" {
    const blinding = generateBlinding();
    const asset_id = assetIdFromSymbol("SOL");
    var owner: FieldElement = undefined;
    @memset(&owner, 0xAB);

    const commitment = generateCommitment(1000000, asset_id, owner, blinding);

    try std.testing.expectEqual(@as(u64, 1000000), commitment.amount);
    try std.testing.expectEqualSlices(u8, &asset_id, &commitment.asset_id);
}

test "crypto: hex conversion roundtrip" {
    var original: FieldElement = undefined;
    for (&original, 0..) |*b, i| {
        b.* = @truncate(i * 7);
    }

    var hex_buf: [64]u8 = undefined;
    const hex_str = toHexString(original, &hex_buf);

    const parsed = try fromHexString(hex_str);
    try std.testing.expectEqualSlices(u8, &original, &parsed);
}

test "crypto: asset id from symbol" {
    const sol_id = assetIdFromSymbol("SOL");
    const usdc_id = assetIdFromSymbol("USDC");

    // 不同代币应该有不同的 ID
    try std.testing.expect(!std.mem.eql(u8, &sol_id, &usdc_id));

    // 相同代币应该有相同的 ID
    const sol_id2 = assetIdFromSymbol("SOL");
    try std.testing.expectEqualSlices(u8, &sol_id, &sol_id2);
}
