"""Mix the two Gemini takes with the existing music stem and no foley."""
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'out' / 'voice-study'
MUSIC = ROOT / 'out' / 'sound-study' / 'music.wav'
VIDEO = ROOT / 'out' / 'sound-study' / 'resolve-sound-study-v1.mp4'

def run(args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return result

def levels(path):
    result = run(['ffmpeg', '-hide_banner', '-i', str(path),
                  '-af', 'loudnorm=print_format=json', '-f', 'null', '-'])
    start = result.stderr.rfind('{')
    return json.loads(result.stderr[start:result.stderr.find('}', start) + 1])

music_levels = levels(MUSIC)
music_gain = min(-31 - float(music_levels['input_i']), -5 - float(music_levels['input_tp']))
report = {}
for voice in ['charon', 'aoede']:
    source = OUT / f'{voice}.wav'
    voice_levels = levels(source)
    gain = min(-18 - float(voice_levels['input_i']), -2.5 - float(voice_levels['input_tp']))
    output = OUT / f'{voice}-with-music.wav'
    filters = (
        f'[0:a]aresample=48000,aformat=channel_layouts=stereo,volume={gain}dB,'
        'adelay=600:all=1,apad=whole_dur=15[voice];'
        f'[1:a]volume={music_gain}dB[music];'
        '[voice][music]amix=inputs=2:duration=longest:normalize=0,'
        'atrim=duration=15,afade=t=out:st=14.5:d=0.5,alimiter=limit=0.89:level=false[mix]'
    )
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
         '-i', str(source), '-i', str(MUSIC), '-filter_complex', filters,
         '-map', '[mix]', '-c:a', 'pcm_s24le', str(output)])
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(output),
         '-c:a', 'libmp3lame', '-b:a', '192k', str(OUT / f'{voice}-with-music.mp3')])
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
         '-i', str(VIDEO), '-i', str(output), '-map', '0:v:0', '-map', '1:a:0',
         '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', '15',
         '-movflags', '+faststart', str(OUT / f'{voice}-preview.mp4')])
    report[voice] = {'voice_gain_db': gain, 'music_gain_db': music_gain,
                     'premaster_voice': voice_levels, 'mix': levels(output),
                     'foley_included': False}
    print(f'{voice}: 15-second preview saved')
(OUT / 'mix-report.json').write_text(json.dumps(report, indent=2) + '\n')
