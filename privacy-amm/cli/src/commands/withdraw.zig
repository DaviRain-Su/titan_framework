// Withdraw Command - 取款
// 从隐私池取出代币到公开地址

const std = @import("std");
const main = @import("../main.zig");
const Config = main.Config;

/// 执行 withdraw 命令
pub fn execute(allocator: std.mem.Allocator, config: Config, args: []const []const u8) !void {
    _ = allocator;
    _ = config;

    var amount: f64 = 0;
    var token: []const u8 = "";
    var recipient: ?[]const u8 = null;

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
        } else if (std.mem.eql(u8, arg, "--to") or std.mem.eql(u8, arg, "--recipient")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("Error: --to requires an address\n", .{});
                return;
            }
            recipient = args[i];
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

    const recipient_display = recipient orelse "(your wallet)";

    std.debug.print("\n", .{});
    std.debug.print("=== Privacy Withdraw ===\n", .{});
    std.debug.print("\n", .{});
    std.debug.print("Withdrawing {d:.6} {s} to {s}...\n", .{ amount, token, recipient_display });
    std.debug.print("\n", .{});

    // 1. 选择 UTXO
    std.debug.print("[1/5] Selecting UTXOs...\n", .{});
    // TODO: 选择满足金额的 UTXO

    // 2. 生成 ZK 证明
    std.debug.print("[2/5] Generating ZK proof...\n", .{});
    // TODO: 调用 snarkjs 生成取款证明

    // 3. 通过 Relayer 提交
    std.debug.print("[3/5] Submitting to relayer...\n", .{});
    // TODO: 提交到 Relayer

    // 4. 等待确认
    std.debug.print("[4/5] Waiting for confirmation...\n", .{});
    // TODO: 等待交易确认

    // 5. 更新本地 UTXO
    std.debug.print("[5/5] Updating local state...\n", .{});
    // TODO: 标记已用 UTXO，保存找零 UTXO

    std.debug.print("\n", .{});
    std.debug.print("=== Withdraw Completed ===\n", .{});
    std.debug.print("\n", .{});
    std.debug.print("Amount:      {d:.6} {s}\n", .{ amount, token });
    std.debug.print("Recipient:   {s}\n", .{recipient_display});
    std.debug.print("Transaction: xxxx...xxxx (simulated)\n", .{});
    std.debug.print("\n", .{});
}

fn printHelp() void {
    const help =
        \\Usage: titan-privacy withdraw [OPTIONS]
        \\
        \\Withdraw tokens from the privacy pool to a public address
        \\
        \\Options:
        \\  -a, --amount <AMOUNT>     Amount to withdraw
        \\  -t, --token <TOKEN>       Token symbol (e.g., SOL, USDC)
        \\  --to, --recipient <ADDR>  Recipient address (default: your wallet)
        \\  -h, --help                Print this help
        \\
        \\Examples:
        \\  titan-privacy withdraw --amount 10 --token SOL
        \\  titan-privacy withdraw -a 100 -t USDC --to 7xKXt...
        \\
    ;
    std.debug.print("{s}", .{help});
}
