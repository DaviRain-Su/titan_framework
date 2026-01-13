const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // Import solana_program_sdk-zig as dependency
    const solana_dep = b.dependency("solana_program_sdk", .{
        .target = target,
        .optimize = optimize,
    });

    // Create program module
    const program_mod = b.createModule(.{
        .root_source_file = b.path("solana-program/src/lib.zig"),
        .target = target,
        .optimize = optimize,
    });
    program_mod.addImport("solana_program_sdk", solana_dep.module("solana_program_sdk"));

    // =========================================================================
    // Tests (native target with SDK)
    // =========================================================================
    const test_step = b.step("test", "Run unit tests");

    // Program tests (native)
    const program_tests = b.addTest(.{
        .root_module = program_mod,
    });

    const run_program_tests = b.addRunArtifact(program_tests);
    test_step.dependOn(&run_program_tests.step);

    // =========================================================================
    // CLI (native target)
    // =========================================================================
    const cli_step = b.step("cli", "Build CLI tool");

    const cli = b.addExecutable(.{
        .name = "titan-privacy",
        .root_module = b.createModule(.{
            .root_source_file = b.path("cli/src/main.zig"),
            .target = target,
            .optimize = optimize,
        }),
    });

    b.installArtifact(cli);
    cli_step.dependOn(&cli.step);

    // CLI tests
    const cli_tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("cli/src/main.zig"),
            .target = target,
            .optimize = optimize,
        }),
    });

    const run_cli_tests = b.addRunArtifact(cli_tests);
    test_step.dependOn(&run_cli_tests.step);

    // =========================================================================
    // Relayer (native target)
    // =========================================================================
    const relayer_step = b.step("relayer", "Build relayer service");

    const relayer = b.addExecutable(.{
        .name = "privacy-relayer",
        .root_module = b.createModule(.{
            .root_source_file = b.path("relayer/src/main.zig"),
            .target = target,
            .optimize = optimize,
        }),
    });

    b.installArtifact(relayer);
    relayer_step.dependOn(&relayer.step);

    // Default step
    b.default_step = test_step;
}
