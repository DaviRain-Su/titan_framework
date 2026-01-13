// Add Liquidity Command - 添加流动性
// 向 AMM 池添加流动性，获得 LP Token

const std = @import("std");
const main = @import("../main.zig");
const Config = main.Config;

/// 执行 add-liquidity 命令
pub fn execute(allocator: std.mem.Allocator, config: Config, args: []const []const u8) !void {
    _ = allocator;

    var amount_a: ?f64 = null;
    var amount_b: ?f64 = null;
    var token_a: []const u8 = "SOL";
    var token_b: []const u8 = "TUSDC";
    var min_lp: f64 = 0;

    // 解析参数
    var i: usize = 0;
    while (i < args.len) : (i += 1) {
        const arg = args[i];
        if (std.mem.eql(u8, arg, "--amount-a") or std.mem.eql(u8, arg, "-a")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("Error: --amount-a requires a value\n", .{});
                return;
            }
            amount_a = std.fmt.parseFloat(f64, args[i]) catch {
                std.debug.print("Error: Invalid amount-a value\n", .{});
                return;
            };
        } else if (std.mem.eql(u8, arg, "--amount-b") or std.mem.eql(u8, arg, "-b")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("Error: --amount-b requires a value\n", .{});
                return;
            }
            amount_b = std.fmt.parseFloat(f64, args[i]) catch {
                std.debug.print("Error: Invalid amount-b value\n", .{});
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
        } else if (std.mem.eql(u8, arg, "--min-lp")) {
            i += 1;
            if (i >= args.len) {
                std.debug.print("Error: --min-lp requires a value\n", .{});
                return;
            }
            min_lp = std.fmt.parseFloat(f64, args[i]) catch {
                std.debug.print("Error: Invalid min-lp value\n", .{});
                return;
            };
        } else if (std.mem.eql(u8, arg, "--help") or std.mem.eql(u8, arg, "-h")) {
            printHelp();
            return;
        }
    }

    if (amount_a == null or amount_b == null) {
        std.debug.print("Error: --amount-a and --amount-b are required\n", .{});
        std.debug.print("Run 'titan-privacy add-liquidity --help' for usage\n", .{});
        return;
    }

    std.debug.print("\n", .{});
    std.debug.print("╔══════════════════════════════════════════════════╗\n", .{});
    std.debug.print("║            Add Liquidity to AMM Pool              ║\n", .{});
    std.debug.print("╚══════════════════════════════════════════════════╝\n", .{});
    std.debug.print("\n", .{});
    std.debug.print("Pool:     {s}/{s}\n", .{ token_a, token_b });
    std.debug.print("Amount A: {d:.6} {s}\n", .{ amount_a.?, token_a });
    std.debug.print("Amount B: {d:.6} {s}\n", .{ amount_b.?, token_b });
    std.debug.print("Min LP:   {d:.6}\n", .{min_lp});
    std.debug.print("RPC:      {s}\n", .{config.rpc_url});
    std.debug.print("\n", .{});

    // 计算预期 LP token (首次添加)
    const lp_estimate = @sqrt(amount_a.? * amount_b.?);
    std.debug.print("[1/4] Estimating LP tokens...\n", .{});
    std.debug.print("       Expected LP: ~{d:.6}\n", .{lp_estimate});

    std.debug.print("[2/4] Building instruction data...\n", .{});
    std.debug.print("       Instruction: AddLiquidity (0x04)\n", .{});

    std.debug.print("[3/4] Creating transaction...\n", .{});
    std.debug.print("       Status: SIMULATED\n", .{});

    std.debug.print("[4/4] Transaction...\n", .{});
    std.debug.print("       Status: SIMULATED (no actual tx sent)\n", .{});

    std.debug.print("\n", .{});
    std.debug.print("=== Add Liquidity Result ===\n", .{});
    std.debug.print("LP Tokens Received: ~{d:.6} (estimated)\n", .{lp_estimate});
    std.debug.print("Status: SIMULATED\n", .{});
    std.debug.print("\n", .{});
}

fn printHelp() void {
    const help =
        \\Add Liquidity - Add liquidity to AMM pool
        \\
        \\Usage: titan-privacy add-liquidity [OPTIONS]
        \\
        \\Options:
        \\  -a, --amount-a <AMOUNT>   Amount of Token A to add (required)
        \\  -b, --amount-b <AMOUNT>   Amount of Token B to add (required)
        \\  --token-a <SYMBOL>        Token A symbol (default: SOL)
        \\  --token-b <SYMBOL>        Token B symbol (default: TUSDC)
        \\  --min-lp <AMOUNT>         Minimum LP tokens to receive (slippage protection)
        \\  -h, --help                Print this help
        \\
        \\Examples:
        \\  titan-privacy add-liquidity --amount-a 10 --amount-b 1500
        \\  titan-privacy add-liquidity -a 5 -b 750 --min-lp 50
        \\
        \\Notes:
        \\  - First liquidity provider sets the initial price ratio
        \\  - Subsequent providers must add in the current pool ratio
        \\  - LP tokens represent your share of the pool
        \\
    ;
    std.debug.print("{s}", .{help});
}
