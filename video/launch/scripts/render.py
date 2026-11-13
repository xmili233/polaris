"""Render once, then reuse the exact video stream for the narration-only version."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
out = root / 'out'
audio = out / 'qa' / 'narration.wav'
audio.parent.mkdir(parents=True, exist_ok=True)

def run(args):
    subprocess.run(args, cwd=root, check=True)

run(['npm', 'run', 'render'])
run(['npx', 'remotion', 'render', 'src/index.ts', 'ResolveLaunch', str(audio),
     '--codec=wav', '--props={"bgm":false}'])
run(['ffmpeg', '-y', '-i', str(out / 'polaris-launch-v2.mp4'), '-i', str(audio),
     '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac',
     '-b:a', '192k', '-t', '45', '-movflags', '+faststart',
     str(out / 'polaris-launch-v2-no-music.mp4')])
