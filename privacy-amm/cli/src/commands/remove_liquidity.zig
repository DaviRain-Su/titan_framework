// Remove Liquidity Command - 移除流动性
// 从 AMM 池移除流动性，销毁 LP Token

const std = @import("std");
const main = @import("../main.zig");
const Config = main.Config;

/// 执行 remove-liquidity 命令
pub fn execute(allocator: std.mem.Allocator, config: Config, args: []const []const u8) !void {
    _ = allocator;

    var lp_amount: ?f64 = null;
    var token_a: []const u8 = "SOL";
    var token_b: []const u8 = "TUSDC";
    var min_a: f64 = 0;
    var min_b: f64 = 0;

    // 解析参数
    var i: usize = 0;
    while (i < args.len) : (i += 1) {
        const arg = args[i];
        if (std.mem.eql(u8, arg, "--lp-amount") or std.mem.eql(u8, arg, "-l")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("Error: --lp-amount requires a value\n", .{});
                return;
            }
            lp_amount = std.fmt.parseFloat(f64, args[i]) catch {
                std.debug.print("Error: Invalid lp-amount value\n", .{});
                return;
            };
        } else if (std.mem.eql(u8, arg, "--token-a")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("Error: --token-a requires a value\n", .{});
                return;
            }
            token_a = args[i];
        } else if (std.mem.eql(u8, arg, "--token-b")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("Error: --token-b requires a value\n", .{});
                return;
            }
            token_b = args[i];
        } else if (std.mem.eql(u8, arg, "--min-a")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("Error: --min-a requires a value\n", .{});
                return;
            }
            min_a = std.fmt.parseFloat(f64, args[i]) catch {
                std.debug.print("Error: Invalid min-a value\n", .{});
                return;
            };
        } else if (std.mem.eql(u8, arg, "--min-b")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("Error: --min-b requires a value\n", .{});
                return;
            }
            min_b = std.fmt.parseFloat(f64, args[i]) catch {
                std.debug.print("Error: Invalid min-b value\n", .{});
                return;
            };
        } else if (std.mem.eql(u8, arg, "--help") or std.mem.eql(u8, arg, "-h")) {
            printHelp();
            return;
        }
    }

    if (lp_amount == null) {
        std.debug.print("Error: --lp-amount is required\n", .{});
        std.debug.print("Run 'titan-privacy remove-liquidity --help' for usage\n", .{});
        return;
    }

    std.debug.print("\n", .{});
    std.debug.print("╔══════════════════════════════════════════════════╗\n", .{});
    std.debug.print("║         Remove Liquidity from AMM Pool            ║\n", .{});
    std.debug.print("╚══════════════════════════════════════════════════╝\n", .{});
    std.debug.print("\n", .{});
    std.debug.print("Pool:      {s}/{s}\n", .{ token_a, token_b });
    std.debug.print("LP Amount: {d:.6}\n", .{lp_amount.?});
    std.debug.print("Min {s}:    {d:.6}\n", .{ token_a, min_a });
    std.debug.print("Min {s}:   {d:.6}\n", .{ token_b, min_b });
    std.debug.print("RPC:       {s}\n", .{config.rpc_url});
    std.debug.print("\n", .{});

    // 模拟池状态 (实际应从链上获取)
    const pool_reserve_a: f64 = 1000.0; // 1000 SOL
    const pool_reserve_b: f64 = 150000.0; // 150000 TUSDC
    const pool_total_lp: f64 = 12247.45; // sqrt(1000 * 150000)

    // 计算预期取回代币
    const share_ratio = lp_amount.? / pool_total_lp;
    const amount_a = pool_reserve_a * share_ratio;
    const amount_b = pool_reserve_b * share_ratio;

    std.debug.print("[1/4] Fetching pool state...\n", .{});
    std.debug.print("       Pool Reserves: {d:.2} {s} / {d:.2} {s}\n", .{ pool_reserve_a, token_a, pool_reserve_b, token_b });
    std.debug.print("       Total LP: {d:.2}\n", .{pool_total_lp});
    std.debug.print("       Your Share: {d:.4}%\n", .{ share_ratio * 100 });

    std.debug.print("[2/4] Calculating withdrawal amounts...\n", .{});
    std.debug.print("       Expected {s}: ~{d:.6}\n", .{ token_a, amount_a });
    std.debug.print("       Expected {s}: ~{d:.6}\n", .{ token_b, amount_b });

    std.debug.print("[3/4] Building instruction data...\n", .{});
    std.debug.print("       Instruction: RemoveLiquidity (0x05)\n", .{});

    std.debug.print("[4/4] Transaction...\n", .{});
    std.debug.print("       Status: SIMULATED (no actual tx sent)\n", .{});

    std.debug.print("\n", .{});
    std.debug.print("=== Remove Liquidity Result ===\n", .{});
    std.debug.print("{s} Received: ~{d:.6} (estimated)\n", .{ token_a, amount_a });
    std.debug.print("{s} Received: ~{d:.6} (estimated)\n", .{ token_b, amount_b });
    std.debug.print("LP Burned: {d:.6}\n", .{lp_amount.?});
    std.debug.print("Status: SIMULATED\n", .{});
    std.debug.print("\n", .{});
}

fn printHelp() void {
    const help =
        \\Remove Liquidity - Remove liquidity from AMM pool
        \\
        \\Usage: titan-privacy remove-liquidity [OPTIONS]
        \\
        \\Options:
        \\  -l, --lp-amount <AMOUNT>  Amount of LP tokens to burn (required)
        \\  --token-a <SYMBOL>        Token A symbol (default: SOL)
        \\  --token-b <SYMBOL>        Token B symbol (default: TUSDC)
        \\  --min-a <AMOUNT>          Minimum Token A to receive (slippage protection)
        \\  --min-b <AMOUNT>          Minimum Token B to receive (slippage protection)
        \\  -h, --help                Print this help
        \\
        \\Examples:
        \\  titan-privacy remove-liquidity --lp-amount 100
        \\  titan-privacy remove-liquidity -l 50 --min-a 4 --min-b 600
        \\
        \\Notes:
        \\  - You receive tokens proportional to your LP share
        \\  - Use --min-a and --min-b for slippage protection
        \\  - Removing all LP tokens closes your position
        \\
    ;
    std.debug.print("{s}", .{help});
}
