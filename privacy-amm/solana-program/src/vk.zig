// Verification Key for Private Swap Circuit
// Auto-generated from circuits/build/verification_key.json
//
// This file contains the Groth16 verification key for the privacy-amm circuit.
// The key was generated during the trusted setup ceremony.
//
// Circuit: private_swap.circom
// Public inputs: 8
// Constraints: 13,095

const std = @import("std");

/// Number of public inputs (excluding the "1" input)
pub const N_PUBLIC: usize = 8;

/// Convert decimal string to 32-byte little-endian array
fn decimalToBytes(comptime decimal: []const u8) [32]u8 {
    @setEvalBranchQuota(10000);
    var result: [32]u8 = [_]u8{0} ** 32;
    var value: u256 = 0;

    for (decimal) |c| {
        value = value * 10 + (c - '0');
    }

    // Convert to little-endian bytes
    inline for (0..32) |i| {
        result[i] = @truncate(value >> (i * 8));
    }

    return result;
}

/// G1 point from two decimal coordinate strings
fn g1Point(comptime x: []const u8, comptime y: []const u8) [64]u8 {
    var result: [64]u8 = undefined;
    const x_bytes = decimalToBytes(x);
    const y_bytes = decimalToBytes(y);
    @memcpy(result[0..32], &x_bytes);
    @memcpy(result[32..64], &y_bytes);
    return result;
}

/// G2 point from four decimal coordinate strings (x0, x1, y0, y1)
/// Note: G2 uses Fp2 extension field, each coordinate has two components
fn g2Point(
    comptime x0: []const u8,
    comptime x1: []const u8,
    comptime y0: []const u8,
    comptime y1: []const u8,
) [128]u8 {
    var result: [128]u8 = undefined;
    // G2 point layout: [x_c0, x_c1, y_c0, y_c1] each 32 bytes
    const x0_bytes = decimalToBytes(x0);
    const x1_bytes = decimalToBytes(x1);
    const y0_bytes = decimalToBytes(y0);
    const y1_bytes = decimalToBytes(y1);
    @memcpy(result[0..32], &x0_bytes);
    @memcpy(result[32..64], &x1_bytes);
    @memcpy(result[64..96], &y0_bytes);
    @memcpy(result[96..128], &y1_bytes);
    return result;
}

// ============================================================================
// Verification Key Constants
// ============================================================================

/// vk.alpha - G1 point
pub const VK_ALPHA: [64]u8 = g1Point(
    "20491192805390485299153009773594534940189261866228447918068658471970481763042",
    "9383485363053290200918347156157836566562967994039712273449902621266178545958",
);

/// vk.beta - G2 point
pub const VK_BETA: [128]u8 = g2Point(
    "6375614351688725206403948262868962793625744043794305715222011528459656738731",
    "4252822878758300859123897981450591353533073413197771768651442665752259397132",
    "10505242626370262277552901082094356697409835680220590971873171140371331206856",
    "21847035105528745403288232691147584728191162732299865338377159692350059136679",
);

/// vk.gamma - G2 point
pub const VK_GAMMA: [128]u8 = g2Point(
    "10857046999023057135944570762232829481370756359578518086990519993285655852781",
    "11559732032986387107991004021392285783925812861821192530917403151452391805634",
    "8495653923123431417604973247489272438418190587263600148770280649306958101930",
    "4082367875863433681332203403145435568316851327593401208105741076214120093531",
);

/// vk.delta - G2 point
pub const VK_DELTA: [128]u8 = g2Point(
    "10857046999023057135944570762232829481370756359578518086990519993285655852781",
    "11559732032986387107991004021392285783925812861821192530917403151452391805634",
    "8495653923123431417604973247489272438418190587263600148770280649306958101930",
    "4082367875863433681332203403145435568316851327593401208105741076214120093531",
);

/// IC (Input Commitments) - Array of G1 points
/// IC[0] is the base point, IC[1..N_PUBLIC+1] are for public inputs
pub const VK_IC: [N_PUBLIC + 1][64]u8 = .{
    // IC[0]
    g1Point(
        "4222848229063522525242782156995585539879807178006766023467986034111738714305",
        "21517373636147431261526992864803905527987724976972612315184378961023607923319",
    ),
    // IC[1] - root
    g1Point(
        "18641884660366265356662177678826179162016635108682907199679560415934620267125",
        "11479961576049963882389388645446986358827171015049859281476769980986895858802",
    ),
    // IC[2] - inputNullifier[0]
    g1Point(
        "4594662841753329104057841405029707632572729111215086648338546525805464293789",
        "4544022899955704517831249423463157607729623130709573284135387825825752271664",
    ),
    // IC[3] - inputNullifier[1]
    g1Point(
        "1025411604439966790787649583309589346903717632499253045994333115567189487728",
        "4370175719065307029710153963506008902470487729837944474604835136527778979314",
    ),
    // IC[4] - outputCommitment[0]
    g1Point(
        "19517549725688458582084706708999155973997214982290810134024116561491950679010",
        "6753520537936512676538626580126541411408827660010370856291350509841990872990",
    ),
    // IC[5] - outputCommitment[1]
    g1Point(
        "6640515572868345498553329847069705110402558198239504993637437010730215844665",
        "3509143733529570505305569237415238181736940336824496875579396643319384144781",
    ),
    // IC[6] - poolStateHash
    g1Point(
        "11267015020236505221805225300536583939160765104639742608300271025801703681279",
        "18177218006026875719690868007109055231844162306062342489182417579014085299202",
    ),
    // IC[7] - newPoolStateHash
    g1Point(
        "9183217690344071814019962001126999642049713362158193121270234383474358188842",
        "16381028399127116134147688736579102508079791370383584059203448779402892306126",
    ),
    // IC[8] - extDataHash
    g1Point(
        "1071951320453028148132909815512171401301609087611398159973350540597738953572",
        "11101912207093980979839913272996166191255033065204672977005985085031442548721",
    ),
};

// ============================================================================
// Tests
// ============================================================================

test "vk: constants are correct size" {
    try std.testing.expectEqual(@as(usize, 64), VK_ALPHA.len);
    try std.testing.expectEqual(@as(usize, 128), VK_BETA.len);
    try std.testing.expectEqual(@as(usize, 128), VK_GAMMA.len);
    try std.testing.expectEqual(@as(usize, 128), VK_DELTA.len);
    try std.testing.expectEqual(@as(usize, 9), VK_IC.len);

    for (VK_IC) |ic| {
        try std.testing.expectEqual(@as(usize, 64), ic.len);
    }
}

test "vk: decimal conversion" {
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
