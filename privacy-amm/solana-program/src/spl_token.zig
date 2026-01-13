// SPL Token Program CPI Interface
// 用于 Privacy AMM 的 SPL Token 交互

const std = @import("std");
const sol = @import("solana_program_sdk");

/// SPL Token Program ID
/// TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
pub const TOKEN_PROGRAM_ID = sol.PublicKey.from([_]u8{
    0x06, 0xdd, 0xf6, 0xe1, 0xd7, 0x65, 0xa1, 0x93,
    0xd9, 0xcb, 0xe1, 0x46, 0xce, 0xeb, 0x79, 0xac,
    0x1c, 0xb4, 0x85, 0xed, 0x5f, 0x5b, 0x37, 0x91,
    0x3a, 0x8c, 0xf5, 0x85, 0x7e, 0xff, 0x00, 0xa9,
});

/// SPL Token instructions
pub const TokenInstruction = enum(u8) {
    InitializeMint = 0,
    InitializeAccount = 1,
    InitializeMultisig = 2,
    Transfer = 3,
    Approve = 4,
    Revoke = 5,
    SetAuthority = 6,
    MintTo = 7,
    Burn = 8,
    CloseAccount = 9,
    FreezeAccount = 10,
    ThawAccount = 11,
    TransferChecked = 12,
    ApproveChecked = 13,
    MintToChecked = 14,
    BurnChecked = 15,
    InitializeAccount2 = 16,
    SyncNative = 17,
    InitializeAccount3 = 18,
    InitializeMultisig2 = 19,
    InitializeMint2 = 20,
};

/// Transfer tokens between accounts
/// Accounts required:
/// - [0] source: Source token account (writable)
/// - [1] destination: Destination token account (writable)
/// - [2] authority: Source account owner/delegate (signer)
pub fn transfer(
    source: sol.account.Account,
    destination: sol.account.Account,
    authority: sol.account.Account,
    amount: u64,
) !void {
    // Build instruction data
    var data: [9]u8 = undefined;
    data[0] = @intFromEnum(TokenInstruction.Transfer);
    std.mem.writeInt(u64, data[1..9], amount, .little);

    // Get account infos (contains stable pointers to pubkeys)
    const source_info = source.info();
    const dest_info = destination.info();
    const auth_info = authority.info();

    // Build account params using pointers from Account.Info
    const accounts = [_]sol.account.Account.Param{
        .{
            .id = source_info.id,
            .is_writable = true,
            .is_signer = false,
        },
        .{
            .id = dest_info.id,
            .is_writable = true,
            .is_signer = false,
        },
        .{
            .id = auth_info.id,
            .is_writable = false,
            .is_signer = true,
        },
    };

    // Build CPI instruction
    const instruction = sol.instruction.Instruction.from(.{
        .program_id = &TOKEN_PROGRAM_ID,
        .accounts = &accounts,
        .data = &data,
    });

    // Collect account infos
    const account_infos = [_]sol.account.Account.Info{
        source_info,
        dest_info,
        auth_info,
    };

    // Invoke
    if (instruction.invoke(&account_infos)) |err| {
        sol.log.log("SPL Token transfer failed");
        return errorFromProgram(err);
    }
}

/// Transfer tokens with PDA signer
pub fn transferSigned(
    source: sol.account.Account,
    destination: sol.account.Account,
    authority: sol.account.Account,
    amount: u64,
    signer_seeds: []const []const u8,
) !void {
    // Build instruction data
    var data: [9]u8 = undefined;
    data[0] = @intFromEnum(TokenInstruction.Transfer);
    std.mem.writeInt(u64, data[1..9], amount, .little);

    // Get account infos
    const source_info = source.info();
    const dest_info = destination.info();
    const auth_info = authority.info();

    // Build account params
    const accounts = [_]sol.account.Account.Param{
        .{
            .id = source_info.id,
            .is_writable = true,
            .is_signer = false,
        },
        .{
            .id = dest_info.id,
            .is_writable = true,
            .is_signer = false,
        },
        .{
            .id = auth_info.id,
            .is_writable = false,
            .is_signer = true,
        },
    };

    // Build CPI instruction
    const instruction = sol.instruction.Instruction.from(.{
        .program_id = &TOKEN_PROGRAM_ID,
        .accounts = &accounts,
        .data = &data,
    });

    // Collect account infos
    const account_infos = [_]sol.account.Account.Info{
        source_info,
        dest_info,
        auth_info,
    };

    // Invoke with seeds
    const seeds = [_][]const []const u8{signer_seeds};
    if (instruction.invokeSigned(&account_infos, &seeds)) |err| {
        sol.log.log("SPL Token transfer (signed) failed");
        return errorFromProgram(err);
    }
}

/// Mint tokens to an account
/// Accounts required:
/// - [0] mint: Token mint (writable)
/// - [1] destination: Destination token account (writable)
/// - [2] mint_authority: Mint authority (signer)
pub fn mintTo(
    mint: sol.account.Account,
    destination: sol.account.Account,
    mint_authority: sol.account.Account,
    amount: u64,
) !void {
    // Build instruction data
    var data: [9]u8 = undefined;
    data[0] = @intFromEnum(TokenInstruction.MintTo);
    std.mem.writeInt(u64, data[1..9], amount, .little);

    // Get account infos
    const mint_info = mint.info();
    const dest_info = destination.info();
    const auth_info = mint_authority.info();

    // Build account params
    const accounts = [_]sol.account.Account.Param{
        .{
            .id = mint_info.id,
            .is_writable = true,
            .is_signer = false,
        },
        .{
            .id = dest_info.id,
            .is_writable = true,
            .is_signer = false,
        },
        .{
            .id = auth_info.id,
            .is_writable = false,
            .is_signer = true,
        },
    };

    // Build CPI instruction
    const instruction = sol.instruction.Instruction.from(.{
        .program_id = &TOKEN_PROGRAM_ID,
        .accounts = &accounts,
        .data = &data,
    });

    // Collect account infos
    const account_infos = [_]sol.account.Account.Info{
        mint_info,
        dest_info,
        auth_info,
    };

    // Invoke
    if (instruction.invoke(&account_infos)) |err| {
        sol.log.log("SPL Token mintTo failed");
        return errorFromProgram(err);
    }
}

/// Mint tokens with PDA signer
pub fn mintToSigned(
    mint: sol.account.Account,
    destination: sol.account.Account,
    mint_authority: sol.account.Account,
    amount: u64,
    signer_seeds: []const []const u8,
) !void {
    // Build instruction data
    var data: [9]u8 = undefined;
    data[0] = @intFromEnum(TokenInstruction.MintTo);
    std.mem.writeInt(u64, data[1..9], amount, .little);

    // Get account infos
    const mint_info = mint.info();
    const dest_info = destination.info();
    const auth_info = mint_authority.info();

    // Build account params
    const accounts = [_]sol.account.Account.Param{
        .{
            .id = mint_info.id,
            .is_writable = true,
            .is_signer = false,
        },
        .{
            .id = dest_info.id,
            .is_writable = true,
            .is_signer = false,
        },
        .{
            .id = auth_info.id,
            .is_writable = false,
            .is_signer = true,
        },
    };

    // Build CPI instruction
    const instruction = sol.instruction.Instruction.from(.{
        .program_id = &TOKEN_PROGRAM_ID,
        .accounts = &accounts,
        .data = &data,
    });

    // Collect account infos
    const account_infos = [_]sol.account.Account.Info{
        mint_info,
        dest_info,
        auth_info,
    };

    // Invoke with seeds
    const seeds = [_][]const []const u8{signer_seeds};
    if (instruction.invokeSigned(&account_infos, &seeds)) |err| {
        sol.log.log("SPL Token mintTo (signed) failed");
        return errorFromProgram(err);
    }
}

/// Burn tokens from an account
/// Accounts required:
/// - [0] account: Token account to burn from (writable)
/// - [1] mint: Token mint (writable)
/// - [2] authority: Account owner (signer)
pub fn burn(
    token_account: sol.account.Account,
    mint: sol.account.Account,
    authority: sol.account.Account,
    amount: u64,
) !void {
    // Build instruction data
    var data: [9]u8 = undefined;
    data[0] = @intFromEnum(TokenInstruction.Burn);
    std.mem.writeInt(u64, data[1..9], amount, .little);

    // Get account infos
    const account_info = token_account.info();
    const mint_info = mint.info();
    const auth_info = authority.info();

    // Build account params
    const accounts = [_]sol.account.Account.Param{
        .{
            .id = account_info.id,
            .is_writable = true,
            .is_signer = false,
        },
        .{
            .id = mint_info.id,
            .is_writable = true,
            .is_signer = false,
        },
        .{
            .id = auth_info.id,
            .is_writable = false,
            .is_signer = true,
        },
    };

    // Build CPI instruction
    const instruction = sol.instruction.Instruction.from(.{
        .program_id = &TOKEN_PROGRAM_ID,
        .accounts = &accounts,
        .data = &data,
    });

    // Collect account infos
    const account_infos = [_]sol.account.Account.Info{
        account_info,
        mint_info,
        auth_info,
    };

    // Invoke
    if (instruction.invoke(&account_infos)) |err| {
        sol.log.log("SPL Token burn failed");
        return errorFromProgram(err);
    }
}

/// Burn tokens with PDA signer
pub fn burnSigned(
    token_account: sol.account.Account,
    mint: sol.account.Account,
    authority: sol.account.Account,
    amount: u64,
    signer_seeds: []const []const u8,
) !void {
    // Build instruction data
    var data: [9]u8 = undefined;
    data[0] = @intFromEnum(TokenInstruction.Burn);
    std.mem.writeInt(u64, data[1..9], amount, .little);

    // Get account infos
    const account_info = token_account.info();
    const mint_info = mint.info();
    const auth_info = authority.info();

    // Build account params
    const accounts = [_]sol.account.Account.Param{
        .{
            .id = account_info.id,
            .is_writable = true,
            .is_signer = false,
        },
        .{
            .id = mint_info.id,
            .is_writable = true,
            .is_signer = false,
        },
        .{
            .id = auth_info.id,
            .is_writable = false,
            .is_signer = true,
        },
    };

    // Build CPI instruction
    const instruction = sol.instruction.Instruction.from(.{
        .program_id = &TOKEN_PROGRAM_ID,
        .accounts = &accounts,
        .data = &data,
    });

    // Collect account infos
    const account_infos = [_]sol.account.Account.Info{
        account_info,
        mint_info,
        auth_info,
    };

    // Invoke with seeds
    const seeds = [_][]const []const u8{signer_seeds};
    if (instruction.invokeSigned(&account_infos, &seeds)) |err| {
        sol.log.log("SPL Token burn (signed) failed");
        return errorFromProgram(err);
    }
}

/// Convert ProgramError to Zig error
fn errorFromProgram(err: sol.ProgramError) error{TokenError} {
    _ = err;
    return error.TokenError;
}

// ============================================================================
// Tests
// ============================================================================

test "spl_token: TOKEN_PROGRAM_ID" {
    // Verify TOKEN_PROGRAM_ID is correct
    // TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
    const expected = [_]u8{
        0x06, 0xdd, 0xf6, 0xe1, 0xd7, 0x65, 0xa1, 0x93,
        0xd9, 0xcb, 0xe1, 0x46, 0xce, 0xeb, 0x79, 0xac,
        0x1c, 0xb4, 0x85, 0xed, 0x5f, 0x5b, 0x37, 0x91,
        0x3a, 0x8c, 0xf5, 0x85, 0x7e, 0xff, 0x00, 0xa9,
    };
    try std.testing.expectEqualSlices(u8, &expected, &TOKEN_PROGRAM_ID.bytes);
}

test "spl_token: TokenInstruction values" {
    try std.testing.expectEqual(@as(u8, 3), @intFromEnum(TokenInstruction.Transfer));
    try std.testing.expectEqual(@as(u8, 7), @intFromEnum(TokenInstruction.MintTo));
    try std.testing.expectEqual(@as(u8, 8), @intFromEnum(TokenInstruction.Burn));
}
