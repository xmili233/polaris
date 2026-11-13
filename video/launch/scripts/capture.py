"""Capture the Electron interface with fictional data and no desktop focus."""
from pathlib import Path
import subprocess

project = Path(__file__).resolve().parents[1]
root = project.parents[1]
subprocess.run([str(root / "macos/scripts/build-app.sh")], check=True)
subprocess.run(["node", str(project / "scripts/capture.mjs")], check=True)
