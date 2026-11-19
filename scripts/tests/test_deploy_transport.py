import contextlib
import importlib.util
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("deploy_transport", Path(__file__).resolve().parents[1] / "deploy-transport.py")
transport = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transport)


class TransportDiagnosticsTests(unittest.TestCase):
    def test_success_reports_phase_without_subprocess_output(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            transport.run_stage("ssh_probe", [sys.executable, "-c", "print('private-host private-key')"], timeout=10)
        self.assertIn("stage=ssh_probe event=start timeout_seconds=10", output.getvalue())
        self.assertIn("stage=ssh_probe event=success elapsed_seconds=", output.getvalue())
        self.assertNotIn("private-host", output.getvalue())
        self.assertNotIn("private-key", output.getvalue())

    def test_failed_authentication_is_classified_without_secrets(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output), self.assertRaises(transport.DeploymentFailure) as caught:
            transport.run_stage("upload", [sys.executable, "-c", "import sys; sys.exit('Permission denied (publickey) for private-user private-key')"], timeout=10)
        self.assertIn("reason=ssh_authentication_rejected exit_code=1", output.getvalue())
        self.assertIn("upload: ssh_authentication_rejected", str(caught.exception))
        self.assertNotIn("private-user", output.getvalue())
        self.assertNotIn("private-key", output.getvalue())

    def test_timeout_kills_subprocess_and_identifies_stage(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output), self.assertRaises(transport.DeploymentFailure) as caught:
            transport.run_stage("upload", [sys.executable, "-c", "import time; time.sleep(60)"], timeout=0.05)
        self.assertIn("stage=upload event=timeout", output.getvalue())
        self.assertIn("timeout_seconds=0.05", output.getvalue())
        self.assertIn("upload: timeout", str(caught.exception))

    def test_start_failure_does_not_expose_command_or_path(self):
        output = io.StringIO()
        with patch.object(transport.subprocess, "Popen", side_effect=OSError("secret command path")):
            with contextlib.redirect_stdout(output), self.assertRaises(transport.DeploymentFailure) as caught:
                transport.run_stage("activate", ["secret-command"], timeout=10)
        self.assertNotIn("secret", output.getvalue() + str(caught.exception))
        self.assertIn("activate: process_start_failed", str(caught.exception))

    def test_cleanup_failure_preserves_original_failure(self):
        output = io.StringIO()
        calls = []

        def fail(stage, *_args, **_kwargs):
            calls.append(stage)
            raise transport.DeploymentFailure(stage + ": failure")

        with patch.object(transport, "run_stage", side_effect=fail), contextlib.redirect_stdout(output):
            with self.assertRaisesRegex(transport.DeploymentFailure, "ssh_probe: failure"):
                transport.transfer([], "safe-path", Path("unused"), upload_timeout=600, activate_timeout=600)
        self.assertEqual(calls, ["ssh_probe", "cleanup"])
        self.assertIn("remote_cleanup_incomplete", output.getvalue())

    def test_transfer_stages_have_distinct_limits(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "archive"
            archive.write_bytes(b"test")
            with patch.object(transport, "run_stage") as run:
                transport.transfer(["ssh"], "safe-path", archive, upload_timeout=600, activate_timeout=900)
        self.assertEqual([call.args[0] for call in run.call_args_list], ["ssh_probe", "upload", "activate", "cleanup"])
        self.assertEqual([call.kwargs["timeout"] for call in run.call_args_list], [30, 600, 900, 30])
        self.assertIn("python3 -u", run.call_args_list[2].args[1][-1])

    def test_unknown_output_and_invalid_timeout_stay_private(self):
        self.assertEqual(transport.failure_kind("private host and application secret"), "command_failed")
        with patch.dict(os.environ, {"FASTDEPLOY_UPLOAD_TIMEOUT": "secret-value"}):
            with self.assertRaisesRegex(transport.DeploymentFailure, "configuration: invalid_timeout"):
                transport.timeout_setting("FASTDEPLOY_UPLOAD_TIMEOUT")


if __name__ == "__main__":
    unittest.main()
