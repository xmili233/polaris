"""Original 15-second ambient score and foley, scored to launch-film seconds 6–21.

Only NumPy, FFmpeg, and the existing film are needed. No reference audio is sampled.
The separate music/SFX stems make the mix easy to revise after listening feedback.
"""
from pathlib import Path
import json
import subprocess
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'out' / 'sound-study'
OUT.mkdir(parents=True, exist_ok=True)
SR, DURATION = 48000, 15
N = SR * DURATION
RNG = np.random.default_rng(28012026)
music = np.zeros((N, 2))
foley = np.zeros((N, 2))
cues = []

def hz(note):
    return 440 * 2 ** ((note - 69) / 12)

def curve(t, attack, decay):
    return (1 - np.exp(-t / attack)) * np.exp(-t / decay)

def noise(length, low, high):
    n = int(length * SR)
    f = np.fft.rfftfreq(n, 1 / SR)
    spectrum = np.fft.rfft(RNG.normal(size=n))
    shape = (1 - np.exp(-(f / max(low, 1)) ** 4)) * np.exp(-(f / high) ** 4)
    y = np.fft.irfft(spectrum * shape, n=n)
    return y / max(np.std(y), 1e-9)

def add(track, sound, at, gain, pan=0):
    start = round(at * SR)
    count = min(len(sound), N - start)
    if count <= 0:
        return
    gains = np.array([np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)])
    track[start:start + count] += sound[:count, None] * gains[None, :] * gain

def pad(notes, at, duration, gain):
    t = np.arange(round(duration * SR)) / SR
    envelope = np.sin(np.pi * np.minimum(t / 1.5, 1) / 2) ** 2
    envelope *= np.sin(np.pi * np.minimum((duration - t) / 1.7, 1) / 2) ** 2
    for i, note in enumerate(notes):
        freq = hz(note)
        drift = .14 * np.sin(2 * np.pi * (.09 + i * .017) * t + i)
        y = np.zeros_like(t)
        for harmonic, level in [(1, 1), (2, .23), (3, .075), (4, .025)]:
            phase = 2 * np.pi * freq * harmonic * t + drift * harmonic
            y += np.sin(phase + i * .47) * level
        y *= envelope * (.94 + .06 * np.sin(2 * np.pi * .23 * t + i))
        add(music, y, at, gain / np.sqrt(len(notes)), (i - (len(notes) - 1) / 2) * .23)

def pluck(note, at, gain=.055, pan=0, decay=.5):
    t = np.arange(round(2.5 * SR)) / SR
    freq = hz(note)
    # A damped, slightly inharmonic resonator: rounded attack, no bright bell spike.
    y = sum(level * np.sin(2 * np.pi * freq * ratio * t + phase)
            * np.exp(-t / (decay / (1 + .42 * i)))
            for i, (ratio, level, phase) in enumerate([(1, 1, 0), (2.002, .21, .2), (3.015, .07, .6)]))
    y *= 1 - np.exp(-t / .012)
    add(music, y, at, gain, pan)

def pulse(at, gain=.032):
    t = np.arange(round(.22 * SR)) / SR
    freq = 56 + 33 * np.exp(-t / .023)
    y = np.sin(2 * np.pi * np.cumsum(freq) / SR) * curve(t, .007, .07)
    y += noise(.22, 110, 950) * curve(t, .004, .018) * .10
    add(music, y, at, gain)

def brush(at, duration, gain, pan, name):
    t = np.arange(round(duration * SR)) / SR
    y = noise(duration, 400, 3400) * np.sin(np.pi * t / duration) ** 2
    add(foley, y, at, gain, pan)
    cues.append({'at': at, 'duration': duration, 'sound': name, 'pan': pan})

def settle(at, gain, pan, name):
    t = np.arange(round(.28 * SR)) / SR
    y = noise(.28, 180, 1700) * curve(t, .004, .023) * .45
    y += np.sin(2 * np.pi * (155 * t - 18 * t * t)) * curve(t, .006, .045) * .5
    add(foley, y, at, gain, pan)
    cues.append({'at': at, 'duration': .28, 'sound': name, 'pan': pan})

def room(track, wet):
    size = round(SR * 1.7)
    t = np.arange(size) / SR
    ir = RNG.normal(size=(size, 2)) * np.exp(-t[:, None] / .33)
    ir[:round(SR * .026)] = 0
    for channel in range(2):
        f = np.fft.rfftfreq(size, 1 / SR)
        ir[:, channel] = np.fft.irfft(np.fft.rfft(ir[:, channel]) * np.exp(-(f / 4200) ** 2), n=size)
        ir[:, channel] /= np.sqrt(np.sum(ir[:, channel] ** 2))
    fft_size = 1 << (N + size - 1).bit_length()
    result = track.copy()
    for channel in range(2):
        source = track[:, channel] * .8 + track[:, 1 - channel] * .2
        reflected = np.fft.irfft(np.fft.rfft(source, fft_size) * np.fft.rfft(ir[:, channel], fft_size), n=fft_size)[:N]
        result[:, channel] += reflected * wet
    return result

# D minor/add9 → B-flat major7/add9 → a quiet D minor/add9 reading bed.
# Harmonic content is original; the reference only informs sparse density and dynamics.
pad([50, 57, 60, 64, 65], 0, 6, .055)
pad([46, 53, 57, 60, 62], 4, 7, .055)
pad([50, 57, 60, 64], 9, 6, .044)
# A downbeat every bar rather than a four-on-the-floor drum loop.
for at in [0, 2, 4, 6, 8]:
    pulse(at, .024)
phrase = [(0, 62), (.75, 69), (1.5, 64), (2, 65), (3, 60), (3.5, 57),
          (4, 62), (4.75, 65), (5.5, 60), (6, 57), (7, 62), (7.5, 64),
          (8, 65), (9, 60), (10, 62), (12, 64)]
for i, (at, note) in enumerate(phrase):
    pluck(note, at, .033 if at < 10 else .017, (-.25, .15, .30, -.1)[i % 4], .46)

# A quiet, filtered air bed keeps the space continuous without a dance hi-hat loop.
t = np.arange(N) / SR
air = noise(DURATION, 220, 2000) * (.65 + .35 * np.sin(2 * np.pi * .1 * t) ** 2)
add(music, air, 0, .0028)
music = room(music, .20)

# The three actual lanes arrive at frames 9, 12 and 15 of the excerpt.
for at, pan in [(.3, -.35), (.4, 0), (.5, .35)]:
    brush(at, .20, .018, pan, 'strategy lane arrives')
    settle(at + .10, .026, pan, 'soft lane landing')
# First card in each lane lands at local frames 55, 63 and 71.
for at, note, pan in [(55/30, 62, -.3), (63/30, 65, 0), (71/30, 69, .3)]:
    settle(at, .023, pan, 'first decision card landing')
    pluck(note, at, .018, pan, .25)
brush(5.47, .88, .011, .1, 'camera approaches the questions')
brush(8.50, .80, .008, -.1, 'camera returns to board')
brush(10.033, .35, .019, 0, 'decision opens')
settle(10.44, .030, 0, 'decision panel settles')
foley = room(foley, .09)

# Pull the music back during the reading shot; leave a natural tail at preview end.
duck = np.interp(t, [0, 9.7, 10.0, 10.85, 15], [1, 1, .75, .38, .38])
end = np.sin(np.pi * np.clip((15 - t) / 1.1, 0, 1) / 2) ** 2
start = np.sin(np.pi * np.clip(t / .4, 0, 1) / 2) ** 2
music *= (duck * start * end)[:, None]
foley *= end[:, None]
mix = music + foley
# Shared gain preserves the exact relation of stems to the final mix.
gain = .75 / np.max(np.abs(mix))

def write_wav(name, values):
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                    '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', 'pipe:0',
                    '-c:a', 'pcm_s24le', str(OUT / name)],
                   input=(values * gain).astype('<f4').tobytes(), check=True)

write_wav('music.wav', music)
write_wav('foley.wav', foley)
write_wav('mix-premaster.wav', mix)
(OUT / 'cues.json').write_text(json.dumps({
    'duration': DURATION, 'source_video_in': 6, 'source_video_out': 21,
    'tempo_bpm': 120, 'seed': 28012026,
    'provenance': 'Original synthesized music and foley; no Linear audio or other samples used.',
    'reading_duck_at': 10, 'cues': cues,
}, indent=2) + '\n')
print(OUT)

# A shared measured linear gain preserves the exact relationship between stems.
analysis = subprocess.run(['ffmpeg', '-hide_banner', '-i', str(OUT / 'mix-premaster.wav'),
                           '-af', 'loudnorm=I=-20:TP=-2:LRA=9:print_format=json',
                           '-f', 'null', '-'], capture_output=True, text=True, check=True)
begin = analysis.stderr.rfind('{')
levels = json.loads(analysis.stderr[begin:analysis.stderr.find('}', begin) + 1])
master_gain = min(-20 - float(levels['input_i']), -2 - float(levels['input_tp']))
(OUT / 'mastering.json').write_text(json.dumps({'premaster': levels, 'linear_gain_db': master_gain}, indent=2) + '\n')
for source, target in [('mix-premaster.wav', 'resolve-sound-study-v1.wav'),
                       ('foley.wav', 'foley-master.wav')]:
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                    '-i', str(OUT / source), '-af', f'volume={master_gain}dB',
                    '-c:a', 'pcm_s24le', str(OUT / target)], check=True)
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                '-i', str(OUT / 'resolve-sound-study-v1.wav'), '-c:a', 'libmp3lame',
                '-b:a', '192k', str(OUT / 'resolve-sound-study-v1.mp3')], check=True)
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-ss', '6',
                '-i', str(ROOT / 'out/polaris-launch-v1.mp4'),
                '-i', str(OUT / 'resolve-sound-study-v1.wav'),
                '-map', '0:v:0', '-map', '1:a:0', '-t', str(DURATION),
                '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
                '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
                str(OUT / 'resolve-sound-study-v1.mp4')], check=True)
subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                '-i', str(OUT / 'resolve-sound-study-v1.mp4'),
                '-i', str(OUT / 'foley-master.wav'),
                '-map', '0:v:0', '-map', '1:a:0', '-t', str(DURATION),
                '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
                '-movflags', '+faststart', str(OUT / 'resolve-sound-study-v1-sfx-only.mp4')], check=True)
