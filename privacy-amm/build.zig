const std = @import("std");

/// SBF target for Solana programs
pub const sbf_target: std.Target.Query = .{
    .cpu_arch = .sbf,
    .os_tag = .solana,
};

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // Import solana_program_sdk-zig as dependency
    const solana_dep = b.dependency("solana_program_sdk", .{
        .target = target,
        .optimize = optimize,
    });

    // Create program module for native tests
    const program_mod = b.createModule(.{
        .root_source_file = b.path("solana-program/src/lib.zig"),
        .target = target,
        .optimize = optimize,
    });
    program_mod.addImport("solana_program_sdk", solana_dep.module("solana_program_sdk"));

    // =========================================================================
    // SBF Program (for deployment to Solana)
    // =========================================================================
    const sbf_step = b.step("sbf", "Build Solana program for SBF target");

    const sbf_resolved_target = b.resolveTargetQuery(sbf_target);

    // Get solana SDK for SBF target
    const solana_sbf_dep = b.dependency("solana_program_sdk", .{
        .target = sbf_resolved_target,
        .optimize = .ReleaseFast,
    });

    const sbf_program = b.addLibrary(.{
        .name = "privacy_amm",
        .linkage = .dynamic,
        .root_module = b.createModule(.{
            .root_source_file = b.path("solana-program/src/lib.zig"),
            .target = sbf_resolved_target,
            .optimize = .ReleaseFast,
        }),
    });

    sbf_program.root_module.addImport("solana_program_sdk", solana_sbf_dep.module("solana_program_sdk"));

    // Apply Solana linker settings
    linkSolanaProgram(b, sbf_program);

    // Install the .so file
    const install_sbf = b.addInstallArtifact(sbf_program, .{
        .dest_dir = .{ .override = .{ .custom = "deploy" } },
    });
    sbf_step.dependOn(&install_sbf.step);

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

    const install_cli = b.addInstallArtifact(cli, .{});
    cli_step.dependOn(&install_cli.step);

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

    // =========================================================================
    // Deploy step (builds SBF and provides deploy command)
    // =========================================================================
    const deploy_step = b.step("deploy", "Build and show deploy command");
    deploy_step.dependOn(sbf_step);

    // Default step
    b.default_step = test_step;
}

/// Apply Solana program linker settings
fn linkSolanaProgram(b: *std.Build, lib: *std.Build.Step.Compile) void {
    const write_file_step = b.addWriteFiles();
    const linker_script = write_file_step.add("bpf.ld",
        \\PHDRS
        \\{
        \\text PT_LOAD  ;
        \\rodata PT_LOAD ;
        \\data PT_LOAD ;
        \\dynamic PT_DYNAMIC ;
        \\}
        \\
        \\SECTIONS
        \\{
        \\. = SIZEOF_HEADERS;
        \\.text : { *(.text*) } :text
        \\.rodata : { *(.rodata*) } :rodata
        \\.data.rel.ro : { *(.data.rel.ro*) } :rodata
        \\.dynamic : { *(.dynamic) } :dynamic
        \\.dynsym : { *(.dynsym) } :data
        \\.dynstr : { *(.dynstr) } :data
        \\.rel.dyn : { *(.rel.dyn) } :data
        \\/DISCARD/ : {
        \\*(.eh_frame*)
        \\*(.gnu.hash*)
        \\*(.hash*)
        \\}
        \\}
    );

    lib.step.dependOn(&write_file_step.step);

    lib.setLinkerScript(linker_script);
    lib.stack_size = 4096;
    lib.link_z_notext = true;
    lib.root_module.pic = true;
    lib.root_module.strip = true;
    lib.entry = .{ .symbol_name = "entrypoint" };
}
