#!/usr/bin/env python3
"""FastDeploy transport with bounded, secret-free phase diagnostics."""
import os
from pathlib import Path
import re
import shlex
import subprocess
import tarfile
import tempfile
import time
import uuid


class DeploymentFailure(RuntimeError):
    """Only fixed diagnostic labels and numeric metadata may reach CI output."""


def report(stage, event, **fields):
    detail = " ".join(f"{key}={value}" for key, value in fields.items())
    print(f"[fastdeploy] stage={stage} event={event} {detail}".rstrip(), flush=True)


def failure_kind(output):
    """Classify output without echoing commands, paths, application data or secrets."""
    patterns = {
        "permission denied": "ssh_authentication_rejected",
        "host key verification failed": "ssh_host_key_rejected",
        "remote host identification has changed": "ssh_host_key_rejected",
        "connection timed out": "ssh_connection_timeout",
        "connection refused": "ssh_connection_refused",
        "could not resolve hostname": "ssh_dns_failed",
        "connection reset": "ssh_connection_interrupted",
        "broken pipe": "ssh_connection_interrupted",
        "no space left on device": "remote_disk_full",
        "another deployment holds the project lock": "remote_deployment_locked",
        "legacy poller still owns this project": "remote_legacy_poller_active",
        "required shared data directory is missing": "remote_data_directory_missing",
        "application readiness check failed": "remote_health_check_failed",
        "release directory exists": "remote_release_already_exists",
        "same run id has different release content": "remote_release_identity_conflict",
        "workflow predates the last deployment": "remote_stale_run",
        "fastdeploy failed;": "remote_activation_failed",
    }
    lowered = output.lower()
    return next((kind for text, kind in patterns.items() if text in lowered), "command_failed")


def run_stage(stage, command, *, timeout, stdin=None):
    started = time.monotonic()
    report(stage, "start", timeout_seconds=timeout)
    # Keep arbitrary SSH/application output private, bounded when reading, and ephemeral.
    with tempfile.TemporaryFile() as output:
        try:
            process = subprocess.Popen(command, stdin=stdin, stdout=output, stderr=output)
        except OSError as error:
            report(stage, "failed", reason="process_start_failed", elapsed_seconds=0)
            raise DeploymentFailure(f"{stage}: process_start_failed") from error
        while True:
            elapsed = time.monotonic() - started
            remaining = timeout - elapsed
            if remaining <= 0:
                process.kill()
                process.wait()
                report(stage, "timeout", elapsed_seconds=round(elapsed, 1), timeout_seconds=timeout)
                raise DeploymentFailure(f"{stage}: timeout after {timeout} seconds")
            try:
                code = process.wait(timeout=min(15, remaining))
                break
            except subprocess.TimeoutExpired:
                report(stage, "running", elapsed_seconds=round(time.monotonic() - started, 1), timeout_seconds=timeout)
        elapsed = round(time.monotonic() - started, 1)
        if code:
            output.seek(0, os.SEEK_END)
            output.seek(max(0, output.tell() - 65536))
            reason = failure_kind(output.read().decode("utf-8", errors="replace"))
            report(stage, "failed", reason=reason, exit_code=code, elapsed_seconds=elapsed)
            raise DeploymentFailure(f"{stage}: {reason} (exit {code})")
        report(stage, "success", elapsed_seconds=elapsed)


def transfer(ssh, remote, archive, *, upload_timeout, activate_timeout):
    try:
        run_stage("ssh_probe", ssh + ["true"], timeout=30)
        with archive.open("rb") as stream:
            run_stage("upload", ssh + [f"umask 077; mkdir -p {remote} && tar -xzf - -C {remote}"],
                      stdin=stream, timeout=upload_timeout)
        run_stage("activate", ssh + [f"python3 -u {remote}/remote.py {remote}"], timeout=activate_timeout)
    finally:
        try:
            run_stage("cleanup", ssh + [f"rm -rf -- {remote}"], timeout=30)
        except DeploymentFailure:
            # A cleanup failure must not obscure the failed phase or a healthy deployment.
            report("cleanup", "warning", reason="remote_cleanup_incomplete")


def timeout_setting(name):
    value = os.environ.get(name, "600")
    if not value.isdigit() or not 30 <= int(value) <= 900:
        raise DeploymentFailure("configuration: invalid_timeout")
    return int(value)


def main():
    os.umask(0o077)
    bundle = Path(os.environ["BUNDLE_DIR"])
    host, user, port = (os.environ[name] for name in ("SSH_HOST", "SSH_USER", "SSH_PORT"))
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.:-]*", host):
        raise DeploymentFailure("configuration: invalid_ssh_host")
    if not re.fullmatch(r"[a-z_][a-z0-9_-]*", user):
        raise DeploymentFailure("configuration: invalid_ssh_user")
    if not port.isdigit() or not 1 <= int(port) <= 65535:
        raise DeploymentFailure("configuration: invalid_ssh_port")
    if not os.environ["SSH_PRIVATE_KEY"].strip() or not os.environ["SSH_KNOWN_HOSTS"].strip():
        raise DeploymentFailure("configuration: ssh_credentials_missing")
    upload_timeout = timeout_setting("FASTDEPLOY_UPLOAD_TIMEOUT")
    activate_timeout = timeout_setting("FASTDEPLOY_ACTIVATE_TIMEOUT")
    with tempfile.TemporaryDirectory(prefix="fastdeploy-ssh-") as directory:
        root = Path(directory)
        (root / "key").write_text(os.environ["SSH_PRIVATE_KEY"] + "\n")
        (root / "known_hosts").write_text(os.environ["SSH_KNOWN_HOSTS"] + "\n")
        config = root / "config"
        config.write_text(
            f"Host fastrd\n  HostName {host}\n  User {user}\n  Port {port}\n"
            f"  IdentityFile {root}/key\n  UserKnownHostsFile {root}/known_hosts\n"
            "  GlobalKnownHostsFile /dev/null\n  StrictHostKeyChecking yes\n"
            "  IdentitiesOnly yes\n  BatchMode yes\n  ConnectTimeout 15\n"
            "  ServerAliveInterval 15\n  ServerAliveCountMax 4\n"
            "  ForwardAgent no\n  LogLevel ERROR\n"
        )
        ssh = ["ssh", "-F", str(config), "fastrd"]
        incoming = ".local/state/fastdeploy/incoming/" + uuid.uuid4().hex
        remote = shlex.quote(incoming)
        archive = root / "bundle.tar.gz"
        report("package", "start")
        with tarfile.open(archive, "w:gz") as tar:
            for path in sorted(bundle.iterdir()):
                if not path.is_file() or path.is_symlink():
                    raise DeploymentFailure("package: invalid_bundle_entry")
                tar.add(path, arcname=path.name)
        report("package", "success", bytes=archive.stat().st_size)
        transfer(ssh, remote, archive, upload_timeout=upload_timeout, activate_timeout=activate_timeout)
        report("deploy", "success")


if __name__ == "__main__":
    try:
        main()
    except DeploymentFailure as error:
        raise SystemExit(f"FastDeploy: {error}")
    except Exception as error:
        # Exception messages and tracebacks may contain credentials or commands.
        report("deploy", "failed", reason="unexpected_error", error_type=type(error).__name__)
        raise SystemExit("FastDeploy: unexpected_error; private output withheld")
