//! Launches the Ash CLI by running the packaged Electron binary as Node.
//!
//! Why a native binary rather than the `.cmd` alone: `cmd.exe` reparses `%*` and
//! executes or truncates embedded newlines, so orchestration message bodies
//! cannot survive it (#8374). `ash-ide.cmd` refuses those subcommands and defers
//! here.
//!
//! Why not a managed assembly: a small freshly-compiled MSIL image in a
//! user-writable directory that mutates environment variables and proxies a
//! child process is the shape antivirus MSIL heuristics are trained on, and it
//! was flagged as exactly that across several vendors (#23383).
//!
use std::env;
use std::path::{Path, PathBuf};
use std::process::{exit, Command};

#[cfg(windows)]
mod administrator_status;

fn main() {
    #[cfg(windows)]
    administrator_status::run_if_requested();
    let launcher = match env::current_exe() {
        Ok(path) => path,
        Err(error) => fail(&format!("Unable to start the Ash CLI: {error}")),
    };
    let Some(resources_directory) = launcher.parent().and_then(Path::parent) else {
        fail(&format!(
            "Unable to locate ash-ide.exe next to \"{}\"",
            launcher.display()
        ))
    };
    let Some(app_directory) = resources_directory.parent() else {
        fail(&format!(
            "Unable to locate ash-ide.exe next to \"{}\"",
            resources_directory.display()
        ))
    };

    let electron_path = app_directory.join("ash-ide.exe");
    if !electron_path.is_file() {
        fail(&format!(
            "Unable to locate ash-ide.exe next to \"{}\"",
            resources_directory.display()
        ));
    }

    let cli_path: PathBuf = resources_directory
        .join("app.asar.unpacked")
        .join("out")
        .join("cli")
        .join("index.js");
    if !cli_path.is_file() {
        fail(&format!(
            "Unable to locate the Ash CLI entrypoint at \"{}\"",
            cli_path.display()
        ));
    }

    // Preserve duplicate PATH/Path entries by inheriting this process’s environment verbatim; an explicit map broke #12046.
    move_environment_variable("NODE_OPTIONS", "ORCA_NODE_OPTIONS");
    move_environment_variable(
        "NODE_REPL_EXTERNAL_MODULE",
        "ORCA_NODE_REPL_EXTERNAL_MODULE",
    );
    env::set_var("ELECTRON_RUN_AS_NODE", "1");
    env::set_var("ORCA_WINDOWS_PACKAGED_CLI_LAUNCHER", "1");
    let requested_command = env::var("ORCA_CLI_COMMAND").unwrap_or_default();
    env::set_var(
        "ORCA_CLI_COMMAND",
        if requested_command == "ash-ide" {
            "ash-ide"
        } else {
            "ash-ide"
        },
    );

    run_cli(&electron_path, &cli_path)
}

fn run_cli(program: &Path, cli_path: &Path) -> ! {
    // Each argument stays its own argv entry, so a body holding newlines reaches
    // the CLI intact.
    let mut command = Command::new(program);
    command.arg(cli_path).args(env::args_os().skip(1));

    match command.status() {
        Ok(status) => exit(status.code().unwrap_or(1)),
        Err(error) => fail(&format!("Unable to start the Ash CLI: {error}")),
    }
}

fn move_environment_variable(source_name: &str, target_name: &str) {
    match env::var_os(source_name) {
        // A missing source clears the target, so a stale value cannot leak in.
        None => env::remove_var(target_name),
        Some(value) => {
            env::remove_var(source_name);
            env::set_var(target_name, value);
        }
    }
}

fn fail(message: &str) -> ! {
    eprintln!("{message}");
    exit(1)
}
