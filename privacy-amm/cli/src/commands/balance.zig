// Balance Command - 查询余额
// 查询隐私池中的余额

const std = @import("std");
const main = @import("../main.zig");
const Config = main.Config;
const utils = main.utils;
const crypto = utils.crypto;
const storage = utils.storage;

/// 执行 balance 命令
pub fn execute(allocator: std.mem.Allocator, config: Config, args: []const []const u8) !void {
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

    // 加载用户公钥 (使用默认)
    const owner_pubkey = getDefaultPubkey();

    // 初始化 UTXO 存储
    var utxo_storage = storage.UtxoStorage.init(allocator, owner_pubkey) catch {
        std.debug.print("No private balances found.\n", .{});
        std.debug.print("Use 'titan-privacy deposit' to add funds.\n", .{});
        std.debug.print("\n", .{});
        return;
    };
    defer utxo_storage.deinit();

    if (token) |t| {
        // 显示特定代币余额
        const balance = utxo_storage.getBalance(t);
        const balance_display = @as(f64, @floatFromInt(balance)) / 1_000_000_000.0;

        std.debug.print("{s}: {d:.6}\n", .{ t, balance_display });

        if (show_utxos) {
            const utxos = try utxo_storage.getUnspentByAsset(t, allocator);
            defer allocator.free(utxos);

            if (utxos.len > 0) {
                std.debug.print("       ({d} UTXOs)\n", .{utxos.len});
                std.debug.print("\n", .{});
                printUtxoDetails(utxos);
            }
        }
    } else if (show_all) {
        // 获取所有余额
        const balances = try utxo_storage.getAllBalances(allocator);
        defer allocator.free(balances);

        if (balances.len == 0) {
            std.debug.print("No private balances found.\n", .{});
            std.debug.print("Use 'titan-privacy deposit' to add funds.\n", .{});
        } else {
            std.debug.print("Token     Amount\n", .{});
            std.debug.print("--------- ----------------\n", .{});

            for (balances) |b| {
                const symbol = b.getSymbol();
                const amount_display = @as(f64, @floatFromInt(b.amount)) / 1_000_000_000.0;
                std.debug.print("{s: <9} {d:>15.6}\n", .{ symbol, amount_display });

                if (show_utxos) {
                    std.debug.print("          ({d} UTXOs)\n", .{b.utxo_count});
                }
            }
        }

        if (show_utxos and balances.len > 0) {
            std.debug.print("\n", .{});
            std.debug.print("UTXO Details:\n", .{});
            std.debug.print("{s}\n", .{"-" ** 50});

            const all_utxos = try utxo_storage.getAllUnspent(allocator);
            defer allocator.free(all_utxos);
            printUtxoDetails(all_utxos);
        }
    } else {
        std.debug.print("Use --all to show all balances or --token <TOKEN> for specific token\n", .{});
        return;
    }

    std.debug.print("\n", .{});
}

/// 打印 UTXO 详情
fn printUtxoDetails(utxos: []const storage.Utxo) void {
    var current_asset: [8]u8 = undefined;
    @memset(&current_asset, 0);

    for (utxos, 0..) |utxo, idx| {
        const asset = utxo.getAssetSymbol();

        // 如果是新资产，打印标题
        if (!std.mem.eql(u8, &current_asset, &utxo.asset)) {
            @memset(&current_asset, 0);
            @memcpy(current_asset[0..asset.len], asset);
            std.debug.print("\n{s} UTXOs:\n", .{asset});
        }

        const amount_display = @as(f64, @floatFromInt(utxo.amount)) / 1_000_000_000.0;

        var commitment_hex: [64]u8 = undefined;
        const commitment_str = crypto.toHexString(utxo.commitment, &commitment_hex);

        const status_str = switch (utxo.status) {
            .unspent => "unspent",
            .pending => "pending",
            .spent => "spent",
        };

        std.debug.print("  #{d}  {d:.6} {s}  (commitment: 0x{s}...) [{s}]\n", .{
            idx + 1,
            amount_display,
            asset,
            commitment_str[0..8],
            status_str,
        });
    }
}

fn getDefaultPubkey() crypto.FieldElement {
    var pubkey: crypto.FieldElement = undefined;
    @memset(&pubkey, 0x42);
    return pubkey;
}

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
