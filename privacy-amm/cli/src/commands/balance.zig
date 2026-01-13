// Balance Command - 查询余额
// 查询隐私池中的余额

const std = @import("std");
const main = @import("../main.zig");
const Config = main.Config;

/// 执行 balance 命令
pub fn execute(allocator: std.mem.Allocator, config: Config, args: []const []const u8) !void {
    _ = allocator;
    _ = config;

    var show_all = false;
    var token: ?[]const u8 = null;
    var show_utxos = false;

    // 解析参数
    var i: usize = 0;
    while (i < args.len) : (i += 1) {
        const arg = args[i];

        if (std.mem.eql(u8, arg, "--all") or std.mem.eql(u8, arg, "-a")) {
            show_all = true;
        } else if (std.mem.eql(u8, arg, "--token") or std.mem.eql(u8, arg, "-t")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("Error: --token requires a symbol\n", .{});
                return;
            }
            token = args[i];
        } else if (std.mem.eql(u8, arg, "--utxos")) {
            show_utxos = true;
        } else if (std.mem.eql(u8, arg, "--help") or std.mem.eql(u8, arg, "-h")) {
            printHelp();
            return;
        }
    }

    std.debug.print("\n", .{});
    std.debug.print("=== Private Balance ===\n", .{});
    std.debug.print("\n", .{});

    // 从本地存储读取 UTXO
    // TODO: 实现真实的 UTXO 读取逻辑

    // 模拟数据
    const balances = [_]TokenBalance{
        .{ .token = "SOL", .amount = 10.5, .utxo_count = 3 },
        .{ .token = "USDC", .amount = 1500.0, .utxo_count = 2 },
        .{ .token = "RAY", .amount = 250.75, .utxo_count = 1 },
    };

    if (token) |t| {
        // 显示特定代币余额
        for (balances) |b| {
            if (std.mem.eql(u8, b.token, t)) {
                std.debug.print("{s}: {d:.6}\n", .{ b.token, b.amount });
                if (show_utxos) {
                    std.debug.print("       ({d} UTXOs)\n", .{b.utxo_count});
                }
                std.debug.print("\n", .{});
                return;
            }
        }
        std.debug.print("{s}: 0.000000\n", .{t});
    } else if (show_all) {
        // 显示所有代币余额
        std.debug.print("Token     Amount\n", .{});
        std.debug.print("--------- ----------------\n", .{});
        for (balances) |b| {
            std.debug.print("{s: <9} {d:>15.6}\n", .{ b.token, b.amount });
            if (show_utxos) {
                std.debug.print("          ({d} UTXOs)\n", .{b.utxo_count});
            }
        }
    } else {
        std.debug.print("Use --all to show all balances or --token <TOKEN> for specific token\n", .{});
        return;
    }

    std.debug.print("\n", .{});

    if (show_utxos) {
        std.debug.print("UTXO Details:\n", .{});
        std.debug.print("─────────────\n", .{});

        // 模拟 UTXO 详情
        std.debug.print("\n", .{});
        std.debug.print("SOL UTXOs:\n", .{});
        std.debug.print("  #1  5.000000 SOL  (commitment: 0x1234...)\n", .{});
        std.debug.print("  #2  3.500000 SOL  (commitment: 0x5678...)\n", .{});
        std.debug.print("  #3  2.000000 SOL  (commitment: 0x9abc...)\n", .{});
        std.debug.print("\n", .{});
        std.debug.print("USDC UTXOs:\n", .{});
        std.debug.print("  #1  1000.000000 USDC  (commitment: 0xdef0...)\n", .{});
        std.debug.print("  #2  500.000000 USDC  (commitment: 0x1357...)\n", .{});
        std.debug.print("\n", .{});
    }
}

const TokenBalance = struct {
    token: []const u8,
    amount: f64,
    utxo_count: u32,
};

fn printHelp() void {
    const help =
        \\Usage: titan-privacy balance [OPTIONS]
        \\
        \\Query your private token balances
        \\
        \\Options:
        \\  -a, --all         Show all token balances
        \\  -t, --token <T>   Show balance for specific token
        \\  --utxos           Show individual UTXO details
        \\  -h, --help        Print this help
        \\
        \\Examples:
        \\  titan-privacy balance --all
        \\  titan-privacy balance --token SOL
        \\  titan-privacy balance --all --utxos
        \\
    ;
    std.debug.print("{s}", .{help});
}
