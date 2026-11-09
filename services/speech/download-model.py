"""Fetch the pinned CPU model with stdlib only, verifying every file."""
import hashlib
from pathlib import Path
import urllib.request

REVISION = "2365baeacb507f821a0c8120fcee3d484dba7a07"
FILES = {
    "model.int8.onnx": "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51",
    "tokens.txt": "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc",
    "LICENSE": "221c6df10b0931a5629adad671ea48fb7747e034c414b6d2bfa275bc3dd4ea17",
}
root = Path(__file__).resolve().parent / "models"
root.mkdir(exist_ok=True)


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as content:
        while chunk := content.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


for name, digest in FILES.items():
    target = root / name
    if target.exists() and sha256(target) == digest:
        continue
    temporary = target.with_suffix(target.suffix + ".part")
    url = f"https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/{REVISION}/{name}"
    try:
        with urllib.request.urlopen(url, timeout=120) as response, temporary.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        if sha256(temporary) != digest:
            raise RuntimeError(f"Checksum mismatch: {name}")
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
print("SenseVoice model verified:", REVISION)
