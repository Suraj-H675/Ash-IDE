"""Observe actual Linux fixture shutdown before stopping its private display.

Never signal a user process by executable name or by a reusable numeric PID.
Only failure cleanup uses pidfds for processes with this fixture's own identity.
"""
import json
import os
from pathlib import Path
import re
import signal
import sys
import time


def fixture_paths(arg):
    supplied = Path(arg)
    root = supplied.resolve(strict=True)
    parent = Path(os.environ.get('ASH_TEST_PRIVATE_ROOT') or '/var/tmp').resolve(strict=True)
    if (
        root.parent != parent
        or not re.fullmatch(r'ash(?:x11|wl)\.[A-Za-z0-9]+', root.name)
        or root.stat().st_uid != os.getuid()
        or root.stat().st_mode & 0o777 != 0o700
        or not (root / '.ash-desktop-lifecycle-fixture').is_file()
        or supplied != root and (supplied != Path('/tmp') / root.name or not supplied.is_symlink())
    ):
        raise ValueError('Not an owned private Ash desktop lifecycle fixture')
    return {str(root), str(supplied)}


def start_ticks(proc):
    return (proc / 'stat').read_text().rsplit(') ', 1)[1].split()[19]


def owned_processes(roots):
    """Return stable process handles and nonsecret evidence, not environment dumps."""
    matches = []
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit():
            continue
        fd = None
        try:
            if proc.stat().st_uid != os.getuid():
                continue
            exe = os.readlink(proc / 'exe').removesuffix(' (deleted)')
            name = Path(exe).name
            if name not in {'ash-ide', 'agent-browser-linux-x64', 'agent-browser-linux-arm64'}:
                continue
            if not (exe.startswith('/tmp/.mount_') or any(exe.startswith(root + '/') for root in roots)):
                continue
            before = start_ticks(proc)
            fd = os.pidfd_open(int(proc.name))
            command = (proc / 'cmdline').read_bytes()
            env = (proc / 'environ').read_bytes().split(b'\0')
            attributed = any(
                ((f'HOME={root}/home').encode() in env and (f'XDG_RUNTIME_DIR={root}/run').encode() in env)
                or re.search(rb'(?:^|[\x00 ])--user-data-dir=' + re.escape((root + '/profile').encode()) + rb'(?:[\x00 ]|$)', command)
                for root in roots
            )
            if not attributed or start_ticks(proc) != before:
                os.close(fd)
                continue
            matches.append((fd, {'pid': int(proc.name), 'startTicks': before, 'exe': name}))
        except (FileNotFoundError, ProcessLookupError):
            if fd is not None:
                os.close(fd)
        except PermissionError:
            if fd is not None:
                os.close(fd)
            # Unreadable unrelated processes (e.g. sandboxed Chromium) are not signalled.
            continue
    return matches


def wait_for_exit(roots, seconds):
    started = time.monotonic()
    while True:
        items = owned_processes(roots)
        elapsed = time.monotonic() - started
        if not items or elapsed >= seconds:
            return items, elapsed
        for fd, _ in items:
            os.close(fd)
        time.sleep(0.25)


def main():
    roots = fixture_paths(sys.argv[1])
    items, elapsed = wait_for_exit(roots, 30)
    print(json.dumps({'ok': not items, 'elapsedSeconds': round(elapsed, 2),
                      'survivorsBeforeCleanup': [record for _, record in items]}), flush=True)
    # A real failure stays red, even if test-only fallback cleanup succeeds.
    for fd, _ in items:
        try:
            signal.pidfd_send_signal(fd, signal.SIGTERM)
        except ProcessLookupError:
            pass
        finally:
            os.close(fd)
    return int(bool(items))


if __name__ == '__main__':
    sys.exit(main())
