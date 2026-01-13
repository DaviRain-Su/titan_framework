// Poseidon Hash for Privacy AMM
// 使用 Solana 的 Poseidon syscall 进行哈希计算
//
// 参数: BN254 曲线, x^5 S-boxes, 兼容 Circom

const std = @import("std");
const sol = @import("solana_program_sdk");
const syscalls = sol.syscalls;

// ============================================================================
// Poseidon Parameters
// ============================================================================

/// Poseidon 参数类型
pub const Parameters = enum(u64) {
    /// BN254 曲线, x^5 S-boxes (兼容 Circom)
    Bn254X5 = 0,
};

/// 字节序
pub const Endianness = enum(u64) {
    BigEndian = 0,
    LittleEndian = 1,
};

/// Poseidon 哈希结果长度
pub const HASH_BYTES: usize = 32;

/// Poseidon 错误
pub const PoseidonError = error{
    InvalidParameters,
    InvalidEndianness,
    InvalidNumberOfInputs,
    EmptyInput,
    InputTooLarge,
    SyscallFailed,
    BytesToBigInt,
    BigIntToBytes,
};

// ============================================================================
// Poseidon Hash Functions
// ============================================================================

/// 计算 Poseidon 哈希 (2 个输入)
/// 用于 Merkle 树节点哈希
pub fn hash2(left: [32]u8, right: [32]u8) PoseidonError![32]u8 {
    // 构建输入数组: 两个 32 字节元素连接
    var input: [64]u8 = undefined;
    @memcpy(input[0..32], &left);
    @memcpy(input[32..64], &right);

    return hashBytes(&input, 2);
}

/// 计算 Poseidon 哈希 (4 个输入)
/// 用于 UTXO commitment: poseidon(amount, assetId, pubkey, blinding)
pub fn hash4(a: [32]u8, b: [32]u8, c: [32]u8, d: [32]u8) PoseidonError![32]u8 {
    var input: [128]u8 = undefined;
    @memcpy(input[0..32], &a);
    @memcpy(input[32..64], &b);
    @memcpy(input[64..96], &c);
    @memcpy(input[96..128], &d);

    return hashBytes(&input, 4);
}

/// 底层 Poseidon 哈希函数
/// 调用 Solana sol_poseidon syscall
fn hashBytes(input: []const u8, num_inputs: u64) PoseidonError![32]u8 {
    if (num_inputs == 0) {
        return PoseidonError.EmptyInput;
    }
    if (num_inputs > 12) {
        return PoseidonError.InvalidNumberOfInputs;
    }
    if (input.len != num_inputs * 32) {
        return PoseidonError.InputTooLarge;
    }

    var result: [32]u8 = undefined;

    // 调用 Poseidon syscall
    // 参数: BN254X5 (0), LittleEndian (1) - Circom 使用 little-endian
    const ret = syscalls.sol_poseidon(
        @intFromEnum(Parameters.Bn254X5),
        @intFromEnum(Endianness.LittleEndian),
        input.ptr,
        num_inputs,
        &result,
    );

    if (ret != 0) {
        sol.log.log("Poseidon syscall failed");
        return PoseidonError.SyscallFailed;
    }

    return result;
}

/// 计算 Poseidon 哈希 (单个输入)
pub fn hash1(input: [32]u8) PoseidonError![32]u8 {
    return hashBytes(&input, 1);
}

/// 计算 Poseidon 哈希 (3 个输入)
/// 用于 Nullifier: poseidon(commitment, privateKey, leafIndex)
pub fn hash3(a: [32]u8, b: [32]u8, c: [32]u8) PoseidonError![32]u8 {
    var input: [96]u8 = undefined;
    @memcpy(input[0..32], &a);
    @memcpy(input[32..64], &b);
    @memcpy(input[64..96], &c);

    return hashBytes(&input, 3);
}

// ============================================================================
// Helper Functions
// ============================================================================

/// 将 u64 转换为 32 字节 (little-endian, 用于 Poseidon)
pub fn u64ToBytes(value: u64) [32]u8 {
    var result: [32]u8 = [_]u8{0} ** 32;
    std.mem.writeInt(u64, result[0..8], value, .little);
    return result;
}

/// 将 u256 (十进制字符串) 转换为 32 字节 (little-endian)
pub fn decimalToBytes(decimal: []const u8) [32]u8 {
    var result: [32]u8 = [_]u8{0} ** 32;
    var value: u256 = 0;

    for (decimal) |c| {
        if (c >= '0' and c <= '9') {
            value = value * 10 + (c - '0');
        }
    }

    // 转换为 little-endian 字节
    inline for (0..32) |i| {
        result[i] = @truncate(value >> (i * 8));
    }

    return result;
}

// ============================================================================
// Precomputed Zero Hashes for Merkle Tree
// ============================================================================

/// 预计算的零值哈希 (用于空 Merkle 树)
/// zeros[0] = 0 (叶子层零值)
/// zeros[i] = poseidon(zeros[i-1], zeros[i-1])
///
/// 注意: 这些值需要在链下预计算并硬编码
/// 因为 Poseidon syscall 只能在运行时调用
pub const ZERO_VALUE: [32]u8 = [_]u8{0} ** 32;

// ============================================================================
// Tests
// ============================================================================

test "poseidon: u64 to bytes" {
    const result = u64ToBytes(12345);
    const expected: u64 = 12345;
    const actual = std.mem.readInt(u64, result[0..8], .little);
    try std.testing.expectEqual(expected, actual);
}

test "poseidon: decimal to bytes" {
    // Test small number
    const one = decimalToBytes("1");
    try std.testing.expectEqual(@as(u8, 1), one[0]);
    for (one[1..]) |b| {
        try std.testing.expectEqual(@as(u8, 0), b);
    }

    // Test 256
    const two_five_six = decimalToBytes("256");
    try std.testing.expectEqual(@as(u8, 0), two_five_six[0]);
    try std.testing.expectEqual(@as(u8, 1), two_five_six[1]);
}
