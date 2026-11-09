"""Launch without putting credentials into shell arguments or a launchd plist."""
import os
from pathlib import Path
import sys

if __name__ == "__main__":
    root = Path(__file__).resolve().parent
    os.chdir(root)
    os.environ["STEER_SPEECH_TOKEN"] = (root / "speech.secret").read_text().strip()
    if (root / "model.path").exists():
        os.environ["STEER_SPEECH_MODEL"] = (root / "model.path").read_text().strip()
    os.execv(sys.executable, [sys.executable, "-m", "uvicorn", "service:create_app", "--factory",
                            "--host", "0.0.0.0", "--port", "8765", "--workers", "1",
                            "--no-access-log", "--limit-concurrency", "8"])
