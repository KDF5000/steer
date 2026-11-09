"""Run on the destination Mac after copying this directory. Reuses its secret."""
import os
from pathlib import Path
import plistlib
import secrets
import subprocess

root = Path(__file__).resolve().parent
secret = root / "speech.secret"
if not secret.exists():
    secret.write_text(secrets.token_urlsafe(32) + "\n")
secret.chmod(0o600)
agents = Path.home() / "Library/LaunchAgents"
agents.mkdir(parents=True, exist_ok=True)
label = "com.steer.speech"
plist = agents / (label + ".plist")
config = {
    "Label": label,
    "ProgramArguments": [str(root / ".venv/bin/python"), str(root / "run.py")],
    "WorkingDirectory": str(root), "RunAtLoad": True, "KeepAlive": True,
    "ThrottleInterval": 30,
    "EnvironmentVariables": {"PATH": "/opt/homebrew/bin:/usr/bin:/bin", "PYTHONUNBUFFERED": "1"},
    "StandardOutPath": str(root / "service.log"), "StandardErrorPath": str(root / "service.log"),
}
plist.write_bytes(plistlib.dumps(config))
plist.chmod(0o600)
domain = f"gui/{os.getuid()}"
subprocess.run(["launchctl", "bootout", domain + "/" + label], capture_output=True)
subprocess.run(["launchctl", "bootstrap", domain, str(plist)], check=True)
print("Installed com.steer.speech on port 8765; secret remains in speech.secret")
