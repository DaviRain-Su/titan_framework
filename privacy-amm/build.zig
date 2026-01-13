const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // =========================================================================
    // Solana Program (SBF target)
    // =========================================================================
    const program_step = b.step("program", "Build Solana on-chain program");

    // Import solana-program-sdk-zig as dependency
    const solana_dep = b.dependency("solana_program_sdk", .{
        .target = b.resolveTargetQuery(.{
            .cpu_arch = .sbf,
            .os_tag = .solana,
        }),
        .optimize = optimize,
    });

    const program = b.addSharedLibrary(.{
        .name = "privacy_amm",
        .root_source_file = b.path("solana-program/src/lib.zig"),
        .target = b.resolveTargetQuery(.{
            .cpu_arch = .sbf,
            .os_tag = .solana,
        }),
        .optimize = optimize,
    });

    program.root_module.addImport("solana-program-sdk", solana_dep.module("solana-program-sdk"));

    // SBF specific settings
    program.entry = .{ .symbol = "entrypoint" };
    program.root_module.pic = true;

    const install_program = b.addInstallArtifact(program, .{
        .dest_dir = .{ .override = .{ .custom = "deploy" } },
    });
    program_step.dependOn(&install_program.step);

    // =========================================================================
    // CLI (native target)
    // =========================================================================
    const cli_step = b.step("cli", "Build CLI tool");

    const cli = b.addExecutable(.{
        .name = "titan-privacy",
        .root_source_file = b.path("cli/src/main.zig"),
        .target = target,
        .optimize = optimize,
    });

    b.installArtifact(cli);
    cli_step.dependOn(&cli.step);

    // =========================================================================
    // Relayer (native target)
    // =========================================================================
    const relayer_step = b.step("relayer", "Build relayer service");

    const relayer = b.addExecutable(.{
        .name = "privacy-relayer",
        .root_source_file = b.path("relayer/src/main.zig"),
        .target = target,
        .optimize = optimize,
    });

    b.installArtifact(relayer);
    relayer_step.dependOn(&relayer.step);

    // =========================================================================
    // Tests
    // =========================================================================
    const test_step = b.step("test", "Run unit tests");

    // Program tests
    const program_tests = b.addTest(.{
        .root_source_file = b.path("solana-program/src/lib.zig"),
        .target = target,
        .optimize = optimize,
    });

    const run_program_tests = b.addRunArtifact(program_tests);
    test_step.dependOn(&run_program_tests.step);

    // CLI tests
    const cli_tests = b.addTest(.{
        .root_source_file = b.path("cli/src/main.zig"),
        .target = target,
        .optimize = optimize,
    });

    const run_cli_tests = b.addRunArtifact(cli_tests);
    test_step.dependOn(&run_cli_tests.step);

    // =========================================================================
    // All (default)
    // =========================================================================
    const all_step = b.step("all", "Build all components");
    all_step.dependOn(program_step);
    all_step.dependOn(cli_step);
    all_step.dependOn(relayer_step);

    b.default_step = all_step;
}
