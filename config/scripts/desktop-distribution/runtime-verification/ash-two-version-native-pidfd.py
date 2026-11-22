#!/usr/bin/env python3
"""QA-only, Linux pidfd-bound identity checks and process lifecycle operations.

Never signal by a numeric PID: open a pidfd first, inspect the pinned process
instance, then signal through that same descriptor. No kill(2) fallback.
"""

import json
import os
from pathlib import Path
import re
import select
import signal
import stat
import sys


ROOT_PATTERN = re.compile(r"/var/tmp/ashcross\.[A-Za-z0-9]{6}\Z")
MARKER = "Test-owned Ash IDE native cross-version fixture\n"


def root_verified(raw: str) -> Path:
    if not ROOT_PATTERN.fullmatch(raw):
        raise ValueError("Invalid private Ash fixture root")
    root = Path(raw)
    info = root.lstat()
    if (
        not stat.S_ISDIR(info.st_mode)
        or info.st_uid != os.getuid()
        or stat.S_IMODE(info.st_mode) != 0o700
        or root.resolve(strict=True) != root
    ):
        raise ValueError("Ash fixture root is not a private real owned directory")
    marker = root / ".ash-native-cross-version-fixture"
    mstat = marker.lstat()
    if not stat.S_ISREG(mstat.st_mode) or marker.read_text() != MARKER:
        raise ValueError("Private fixture identity marker is missing")
    return root


def read_bytes(path: Path) -> bytes:
    return path.read_bytes()


def start_ticks(pid: int) -> str:
    # Field 22 of /proc/PID/stat; the executable name may contain whitespace.
    raw = (Path("/proc") / str(pid) / "stat").read_text()
    return raw.rsplit(") ", 1)[1].split()[19]


def validate_instance(
    pid: int, kind: str, root: Path, expected_ticks: str, *, require_command_identity: bool = True
) -> None:
    proc = Path("/proc") / str(pid)
    status = (proc / "status").read_text()
    owner = int(re.search(r"^Uid:\s+(\d+)", status, re.MULTILINE).group(1))
    if owner != os.getuid() or start_ticks(pid) != expected_ticks:
        raise ValueError("PID owner or process-incarnation mismatch")

    # Runtime shutdown may clear argv/env before pidfd reports process exit.
    # A *wait* is non-signaling and only needs the captured instance identity;
    # any signal still requires the complete command/path checks below.
    if not require_command_identity:
        return

    argv = read_bytes(proc / "cmdline").split(b"\0")
    if not argv or not argv[0]:
        raise ValueError("Process command line is unavailable")
    args = [arg.decode("utf8", errors="surrogateescape") for arg in argv if arg]
    if kind == "app":
        env = read_bytes(proc / "environ").split(b"\0")
        if (
            f"ASH_USER_DATA_PATH={root}/profile".encode() not in env
            or not (
                any("ash-ide" in item for item in args)
                or args[0] in {str(root / "previous.AppImage"), str(root / "candidate.AppImage")}
            )
        ):
            raise ValueError("Process is not the private Ash app")
    elif kind == "xvfb":
        if (
            Path(args[0]).name != "Xvfb"
            or Path(os.readlink(proc / "exe")).name != "Xvfb"
            or "-auth" not in args
            or args[args.index("-auth") + 1] != str(root / "Xauthority")
        ):
            raise ValueError("Process is not the authenticated private Xvfb server")
    elif kind == "daemon":
        record_path = root / "profile" / "daemon" / "daemon-v55.pid"
        record = json.loads(record_path.read_text())
        if (
            record.get("pid") != pid
            or str(record.get("linuxStartTicks")) != expected_ticks
            or not args[0].startswith(str(root / "home" / ".cache" / "ash-ide" / "appimage") + "/")
            or not any(item.endswith("/daemon-entry.js") for item in args)
            or "--pid-record" not in args
            or args[args.index("--pid-record") + 1] != str(record_path)
            or "--token" not in args
            or args[args.index("--token") + 1] != str(record_path.parent / "daemon-v55.token")
        ):
            raise ValueError("Daemon PID-record or process identity mismatch")
    else:
        raise ValueError("Unknown fixture process kind")


def operate(mode: str, kind: str, root_arg: str, pid_arg: str, ticks_arg: str | None) -> dict:
    if mode not in {"snapshot", "wait", "signal"}:
        raise ValueError("Unknown pidfd operation")
    if mode == "wait" and kind != "app":
        raise ValueError("Only the app runtime has a native-exit wait contract")
    root = root_verified(root_arg)
    pid = int(pid_arg)
    if pid <= 1:
        raise ValueError("Invalid fixture process PID")
    if mode != "snapshot" and (not ticks_arg or not re.fullmatch(r"[1-9]\d*", ticks_arg)):
        raise ValueError("Expected process-incarnation ticks are required")

    # Once acquired, this descriptor continues to refer to the *same* process
    # incarnation even if the numeric PID is eventually reused.
    try:
        descriptor = os.pidfd_open(pid, 0)
    except ProcessLookupError:
        if mode == "wait":
            return {"status": "already-exited"}
        if mode == "signal":
            return {"status": "already-exited"}
        raise ValueError("Process vanished before its incarnation could be pinned")
    with os.fdopen(descriptor, "rb", closefd=True):
        poller = select.poll()
        poller.register(descriptor, select.POLLIN)
        if mode != "snapshot" and poller.poll(0):
            return {"status": "already-exited"}
        try:
            actual_ticks = start_ticks(pid)
            validate_instance(
                pid, kind, root, ticks_arg or actual_ticks,
                require_command_identity=mode != "wait"
            )
        except FileNotFoundError:
            if mode in {"wait", "signal"}:
                return {"status": "already-exited"}
            raise ValueError("Process vanished during identity capture")
        if mode == "snapshot":
            return {"status": "pinned", "linuxStartTicks": actual_ticks}
        if mode == "wait":
            if not poller.poll(15000):
                raise TimeoutError("Runtime accepted stop but the original app process did not exit")
            return {"status": "exited"}
        try:
            signal.pidfd_send_signal(descriptor, signal.SIGTERM)
        except ProcessLookupError:
            return {"status": "already-exited"}
        return {"status": "signaled-pidfd"}


if __name__ == "__main__":
    try:
        if len(sys.argv) not in {5, 6}:
            raise ValueError("Usage: pidfd.py snapshot|wait|signal app|daemon|xvfb ROOT PID [START_TICKS]")
        result = operate(*sys.argv[1:], None) if len(sys.argv) == 5 else operate(*sys.argv[1:])
        print(json.dumps(result))
    except (AssertionError, OSError, ValueError, TimeoutError, IndexError, TypeError) as exc:
        print(f"[ash-pidfd-qa] {exc}", file=sys.stderr)
        sys.exit(1)
