"""Extend the accepted original score and place Aoede narration on the 45s film."""
import json
from pathlib import Path
import subprocess

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'out' / 'narration'
PUBLIC = ROOT / 'public' / 'audio'
SR, DURATION = 48000, 45
N = SR * DURATION
music = np.zeros((N, 2))
voice = np.zeros_like(music)


def run(args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, **kwargs)


def write(path, samples):
    assert np.isfinite(samples).all() and np.max(np.abs(samples)) < 1
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'f32le',
         '-ar', str(SR), '-ac', '2', '-i', 'pipe:0', '-c:a', 'pcm_s24le', str(path)],
        input=samples.astype('<f4').tobytes())


def levels(path):
    result = run(['ffmpeg', '-hide_banner', '-i', str(path), '-af',
                  'loudnorm=print_format=json', '-f', 'null', '-'], text=True)
    begin = result.stderr.rfind('{')
    return json.loads(result.stderr[begin:result.stderr.find('}', begin) + 1])


def add(sound, at, gain, pan=0):
    start = round(at * SR)
    count = min(len(sound), N - start)
    gains = np.array([np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)])
    music[start:start + count] += sound[:count, None] * gains * gain


def pad(notes, at, duration, gain):
    t = np.arange(round(duration * SR)) / SR
    envelope = np.sin(np.pi * np.minimum(t / 1.5, 1) / 2) ** 2
    envelope *= np.sin(np.pi * np.minimum((duration - t) / 1.7, 1) / 2) ** 2
    for i, note in enumerate(notes):
        freq = 440 * 2 ** ((note - 69) / 12)
        drift = .14 * np.sin(2 * np.pi * (.09 + i * .017) * t + i)
        y = sum(np.sin(2 * np.pi * freq * harmonic * t + drift * harmonic + i * .47) * level
                for harmonic, level in [(1, 1), (2, .23), (3, .075), (4, .025)])
        y *= envelope * (.94 + .06 * np.sin(2 * np.pi * .23 * t + i))
        add(y, at, gain / np.sqrt(len(notes)), (i - (len(notes) - 1) / 2) * .23)


def pluck(note, at, gain=.033, pan=0):
    t = np.arange(round(2.5 * SR)) / SR
    freq = 440 * 2 ** ((note - 69) / 12)
    y = sum(level * np.sin(2 * np.pi * freq * ratio * t + phase)
            * np.exp(-t / (.46 / (1 + .42 * i)))
            for i, (ratio, level, phase) in enumerate([(1, 1, 0), (2.002, .21, .2), (3.015, .07, .6)]))
    add(y * (1 - np.exp(-t / .012)), at, gain, pan)


# The same harmony and rounded pluck as the approved study, without its air/noise layers.
for notes, at, duration, gain in [
    ([50, 57, 60, 64], 0, 9, .044), ([50, 57, 60, 64, 65], 6, 7, .055),
    ([46, 53, 57, 60, 62], 10, 9, .055), ([50, 57, 60, 64], 16, 10, .040),
    ([46, 53, 57, 60, 62], 23, 9, .043), ([50, 57, 60, 64, 65], 29, 10, .048),
    ([46, 53, 57, 60, 62], 36, 7, .044), ([50, 57, 60, 64], 40, 5, .038),
]:
    pad(notes, at, duration, gain)
phrase = [(0, 62), (.75, 69), (1.5, 64), (2, 65), (3, 60), (3.5, 57),
          (4, 62), (4.75, 65), (5.5, 60), (6, 57), (7, 62), (7.5, 64),
          (8, 65), (9, 60)]
for i, (at, note) in enumerate(phrase):
    pluck(note, 6 + at, .033, (-.25, .15, .30, -.1)[i % 4])
for i, (at, note) in enumerate([(1, 62), (3, 64), (17, 62), (20, 64), (23, 60),
                               (26, 62), (29, 65), (31, 60), (33, 62), (35, 64),
                               (38, 65), (40, 60), (42, 62)]):
    pluck(note, at, .019, (-.2, .2)[i % 2])
for at in [6, 8, 10, 12, 14, 30, 34, 38]:
    t = np.arange(round(.22 * SR)) / SR
    freq = 56 + 33 * np.exp(-t / .023)
    add(np.sin(2 * np.pi * np.cumsum(freq) / SR)
        * (1 - np.exp(-t / .007)) * np.exp(-t / .07), at, .018)

# Gentle stereo reflections of the instruments, without a separate noise bed.
dry = music.copy()
for delay, gain in [(.109, .085), (.173, .05), (.257, .026)]:
    offset = round(delay * SR)
    music[offset:] += dry[:-offset, ::-1] * gain
t = np.arange(N) / SR
music *= (np.sin(np.pi * np.clip(t / .4, 0, 1) / 2) ** 2
          * np.sin(np.pi * np.clip((DURATION - t) / 1.4, 0, 1) / 2) ** 2)[:, None]
OUT.mkdir(parents=True, exist_ok=True)
PUBLIC.mkdir(parents=True, exist_ok=True)
write(OUT / 'score-premaster.wav', music)
music_levels = levels(OUT / 'score-premaster.wav')
music_gain = min(-29.5 - float(music_levels['input_i']), -8 - float(music_levels['input_tp']))
music *= 10 ** (music_gain / 20)

spec = json.loads((ROOT / 'assets/narration.json').read_text())
report = {'voice': spec['voice'], 'duration_seconds': DURATION,
          'music_gain_db': music_gain, 'foley_included': False, 'takes': []}
duck = np.ones(N)
previous_end = 0
for take in spec['takes']:
    source = OUT / f"{take['id']}.wav"
    raw = run(['ffmpeg', '-loglevel', 'error', '-i', str(source), '-f', 'f32le',
               '-ac', '2', '-ar', str(SR), 'pipe:1']).stdout
    samples = np.frombuffer(raw, dtype='<f4').reshape(-1, 2).copy()
    # Remove only near-silence at the outside, retaining breaths and consonant edges.
    window = SR // 100
    blocks = samples[:len(samples) // window * window].reshape(-1, window, 2)
    rms = np.sqrt(np.mean(blocks ** 2, axis=(1, 2)))
    active = np.flatnonzero(rms > 10 ** (-48 / 20))
    assert len(active), f"Silent narration: {take['id']}"
    begin = max(0, active[0] * window - round(.08 * SR))
    end = min(len(samples), (active[-1] + 1) * window + round(.15 * SR))
    samples = samples[begin:end]
    measured = levels(source)
    gain = min(-18.5 - float(measured['input_i']), -3 - float(measured['input_tp']))
    samples *= 10 ** (gain / 20)
    start = round(take['at'] * SR)
    stop = start + len(samples)
    assert start >= previous_end and stop / SR <= take['until'], (
        f"Narration overrun: {take['id']} ends at {stop / SR:.2f}, deadline {take['until']}")
    previous_end = stop
    voice[start:stop] += samples
    # Music gently dips under each utterance, then returns during the reading pauses.
    points = [max(0, take['at'] - .18), take['at'], stop / SR, min(DURATION, stop / SR + .35)]
    envelope = np.interp(t, points, [1, .71, .71, 1], left=1, right=1)
    duck = np.minimum(duck, envelope)
    report['takes'].append({**take, 'end': stop / SR, 'trim_start_seconds': begin / SR,
                            'gain_db': gain, 'source_levels': measured})

music *= duck[:, None]
mix = voice + music
assert np.max(np.abs(mix)) < .89, 'Mix needs more peak headroom'
write(PUBLIC / 'narration.wav', voice)
write(PUBLIC / 'score.wav', music)
write(OUT / 'mix.wav', mix)
for name, samples in [('narration', voice), ('score', music), ('mix', mix)]:
    path = OUT / 'mix.wav' if name == 'mix' else PUBLIC / f'{name}.wav'
    report[name] = {**levels(path), 'sample_peak': float(np.max(np.abs(samples)))}
for suffix, audio in [('', OUT / 'mix.wav'), ('-no-music', PUBLIC / 'narration.wav')]:
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
         '-i', str(ROOT / 'out/polaris-launch-v1.mp4'), '-i', str(audio),
         '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac',
         '-b:a', '192k', '-t', str(DURATION), '-movflags', '+faststart',
         str(ROOT / f'out/polaris-launch-v2{suffix}.mp4')])
(OUT / 'mix-report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'mix': report['mix'], 'takes': [
    {'id': take['id'], 'start': take['at'], 'end': take['end']} for take in report['takes']
]}, indent=2))
