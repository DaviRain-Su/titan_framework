// Deposit Command - 存款
// 将公开代币存入隐私池

const std = @import("std");
const main = @import("../main.zig");
const Config = main.Config;

/// 执行 deposit 命令
pub fn execute(allocator: std.mem.Allocator, config: Config, args: []const []const u8) !void {
    _ = allocator;
    _ = config;

    var amount: f64 = 0;
    var token: []const u8 = "";

    // 解析参数
    var i: usize = 0;
    while (i < args.len) : (i += 1) {
        const arg = args[i];

        if (std.mem.eql(u8, arg, "--amount") or std.mem.eql(u8, arg, "-a")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("Error: --amount requires a value\n", .{});
                return;
            }
            amount = try std.fmt.parseFloat(f64, args[i]);
        } else if (std.mem.eql(u8, arg, "--token") or std.mem.eql(u8, arg, "-t")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("Error: --token requires a symbol\n", .{});
                return;
            }
            token = args[i];
        } else if (std.mem.eql(u8, arg, "--help") or std.mem.eql(u8, arg, "-h")) {
            printHelp();
            return;
        }
    }

    if (amount <= 0) {
        std.debug.print("Error: --amount is required and must be positive\n", .{});
        return;
    }
    if (token.len == 0) {
        std.debug.print("Error: --token is required\n", .{});
        return;
    }

    std.debug.print("\n", .{});
    std.debug.print("=== Privacy Deposit ===\n", .{});
    std.debug.print("\n", .{});
    std.debug.print("Depositing {d:.6} {s} into privacy pool...\n", .{ amount, token });
    std.debug.print("\n", .{});

    // 1. 生成随机 blinding
    std.debug.print("[1/4] Generating commitment...\n", .{});
    // TODO: 生成 commitment = poseidon(amount, asset_id, pubkey, blinding)

    // 2. 发送代币到池
    std.debug.print("[2/4] Sending tokens to pool...\n", .{});
    // TODO: 调用 SPL Token transfer

    // 3. 调用链上 deposit 指令
    std.debug.print("[3/4] Calling deposit instruction...\n", .{});
    // TODO: 构建并发送 Solana 交易

    // 4. 保存 UTXO 到本地
    std.debug.print("[4/4] Saving UTXO locally...\n", .{});
    // TODO: 保存 UTXO 信息到本地数据库

    std.debug.print("\n", .{});
    std.debug.print("=== Deposit Completed ===\n", .{});
    std.debug.print("\n", .{});
    std.debug.print("Amount:      {d:.6} {s}\n", .{ amount, token });
    std.debug.print("Transaction: xxxx...xxxx (simulated)\n", .{});
    std.debug.print("\n", .{});
    std.debug.print("Your tokens are now private!\n", .{});
    std.debug.print("Use 'titan-privacy balance' to check your private balance.\n", .{});
    std.debug.print("\n", .{});
}

fn printHelp() void {
    const help =
        \\Usage: titan-privacy deposit [OPTIONS]
        \\
        \\Deposit tokens into the privacy pool
        \\
        \\Options:
        \\  -a, --amount <AMOUNT>  Amount to deposit
        \\  -t, --token <TOKEN>    Token symbol (e.g., SOL, USDC)
        \\  -h, --help             Print this help
        \\
        \\Examples:
        \\  titan-privacy deposit --amount 10 --token SOL
        \\  titan-privacy deposit -a 100 -t USDC
        \\
    ;
    std.debug.print("{s}", .{help});
}
