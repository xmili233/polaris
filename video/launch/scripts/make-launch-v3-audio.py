"""Beat-driven score for the open-source launch film (both languages).

120 BPM in D minor: a beat is 0.5 s (15 frames), a bar 2 s (60 frames). Every cue is
read from src/v3/timeline.json, the same file the film uses, and key moments are
asserted to sit on beats. The arrangement follows the rhythm sheet used by code-made
launch films: a hit on the first frame and a grooving hook so viewers stay, a build
that closes a filter, one beat of silence, the drop on the hero moment (the twelve cards
landing), a peak for the goals, a breakdown and a
final hit on the logo. Everything is synthesized here (no samples, no paid services).
Narration is mixed in when every take in assets/narration-v3.json exists under
out/narration-v3/.
"""
import json
from pathlib import Path
import subprocess

import numpy as np
from scipy.signal import butter, sosfilt

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'out'
VOICE = OUT / 'narration-v3'
TL = json.loads((ROOT / 'src/v3/timeline.json').read_text())
SR, BPM, FPS = 48000, TL['bpm'], TL['fps']
DURATION = TL['frames'] / FPS
BEAT, BAR = 60 / BPM, 240 / BPM
N = round(SR * DURATION)
rng = np.random.default_rng(7)
drums = np.zeros((N, 2))
music = np.zeros((N, 2))   # bass, pads, stabs and arpeggios: ducked by the kick
accents = np.zeros((N, 2))  # event plucks that follow the picture


def run(args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, **kwargs)


def write(path, samples):
    assert np.isfinite(samples).all() and np.max(np.abs(samples)) < 1
    run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2',
         '-i', 'pipe:0', '-c:a', 'pcm_s24le', str(path)], input=samples.astype('<f4').tobytes())


def levels(path):
    result = run(['ffmpeg', '-hide_banner', '-i', str(path), '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], text=True)
    begin = result.stderr.rfind('{')
    return json.loads(result.stderr[begin:result.stderr.find('}', begin) + 1])


def place(bus, sound, at, gain, pan=0.0):
    start = round(at * SR)
    if start >= N:
        return
    count = min(len(sound), N - start)
    gains = np.array([np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)])
    bus[start:start + count] += sound[:count, None] * gains * gain


def filt(kind, cutoff, signal, order=2):
    return sosfilt(butter(order, cutoff, btype=kind, fs=SR, output='sos'), signal)


def time(seconds):
    return np.arange(round(seconds * SR)) / SR


hz = lambda note: 440 * 2 ** ((note - 69) / 12)


# --- Drum kit -------------------------------------------------------------------------
def kick():
    t = time(.42)
    phase = 2 * np.pi * np.cumsum(47 + 115 * np.exp(-t / .028)) / SR
    click = filt('highpass', 3000, rng.standard_normal(len(t))) * np.exp(-t / .002)
    return np.sin(phase) * np.exp(-t / .24) * (1 - np.exp(-t / .0015)) + .12 * click


def clap():
    t = time(.4)
    noise = filt('bandpass', [900, 3200], rng.standard_normal(len(t)))
    env = sum(np.where(t >= d, np.exp(-(t - d) / .006), 0) for d in (0, .011, .023))
    env += np.where(t >= .03, .7 * np.exp(-(t - .03) / .11), 0)
    return noise * env * 3.2


def hat(open_=False):
    t = time(.3 if open_ else .08)
    return filt('highpass', 7500, rng.standard_normal(len(t))) * np.exp(-t / (.16 if open_ else .022)) * 1.6


def snare():
    t = time(.25)
    body = np.sin(2 * np.pi * 186 * t) * np.exp(-t / .05)
    return .6 * body + filt('bandpass', [1600, 6500], rng.standard_normal(len(t))) * np.exp(-t / .085) * 1.8


def crash():
    t = time(2.2)
    return filt('highpass', 4200, rng.standard_normal(len(t))) * np.exp(-t / .9) * (1 - np.exp(-t / .004))


def boom():
    t = time(1.6)
    return np.sin(2 * np.pi * np.cumsum(38 + 26 * np.exp(-t / .08)) / SR) * np.exp(-t / .55) * (1 - np.exp(-t / .004))


KICK, CLAP, HAT, OPEN, SNARE, CRASH, BOOM = kick(), clap(), hat(), hat(True), snare(), crash(), boom()


# --- Tonal instruments ----------------------------------------------------------------
def saw(note, seconds, harmonics=10):
    t = time(seconds)
    return sum(np.sin(2 * np.pi * hz(note) * k * t + k * .3) / k for k in range(1, harmonics + 1)), t


def bass(note, seconds=.23):
    y, t = saw(note, seconds, 12)
    env = (1 - np.exp(-t / .004)) * (.55 + .45 * np.exp(-t / .07)) * np.clip((seconds - t) / .025, 0, 1)
    return filt('lowpass', 520, y) * env


def pad(notes, seconds):
    t = time(seconds)
    env = np.sin(np.pi * np.minimum(t / .9, 1) / 2) ** 2 * np.sin(np.pi * np.minimum((seconds - t) / 1.1, 1) / 2) ** 2
    y = np.zeros(len(t))
    for i, note in enumerate(notes):
        drift = .12 * np.sin(2 * np.pi * (.09 + i * .017) * t + i)
        y += sum(np.sin(2 * np.pi * hz(note) * h * t + drift * h + i * .47) * level for h, level in [(1, 1), (2, .23), (3, .075), (4, .025)])
    return y * env / np.sqrt(len(notes))


def pluck(note, seconds=1.6, bright=1.0):
    t = time(seconds)
    y = sum(level * np.sin(2 * np.pi * hz(note) * ratio * t + phase) * np.exp(-t / (.42 / (1 + .42 * i * bright)))
            for i, (ratio, level, phase) in enumerate([(1, 1, 0), (2.002, .26 * bright, .2), (3.015, .09 * bright, .6), (4.01, .04 * bright, 1)]))
    return y * (1 - np.exp(-t / .006))


def stab(notes):
    t = time(.32)
    y = sum(saw(note, .32, 8)[0] for note in notes) / len(notes)
    return filt('lowpass', 2400, y) * np.exp(-t / .09) * (1 - np.exp(-t / .003))


# --- Cues from the shared timeline (seconds) ----------------------------------------------
SC = TL['scenes']
at = lambda scene, frame=0: (SC[scene]['from'] + frame) / FPS
W, D, G, ST = TL['work'], TL['decide'], TL['goals'], TL['strategy']
LIFT, DROP = at('work', W['lift']), at('work', W['flyStart'] + W['fly'])
CARDS = [at('work', W['flyStart'] + i * W['flyGap'] + W['fly']) for i in range(12)]
CARD_OPEN, CHOOSE, CONFIRM = at('decide', D['open']), at('decide', D['select']), at('decide', D['confirm'])
GOALS, ARRIVE = at('goals'), [at('goals', frame) for frame in G['arrivals']]
LIGHT = at('strategy')
SUGGEST, S_CHOOSE, S_CONFIRM = at('strategy', ST['arrive']), at('strategy', ST['select']), at('strategy', ST['confirm'])
NEW_CARDS = [at('strategy', ST['firstCard'] + i * ST['cardGap'] + ST['drop']) for i in range(3)]
FOCUS, LOGO = at('focus'), at('end')
BUILD = DROP - BAR
on_beat = lambda x: abs(x / BEAT - round(x / BEAT)) < 1e-6
assert all(map(on_beat, [LIFT, DROP, CARD_OPEN, CHOOSE, CONFIRM, GOALS, *ARRIVE, LIGHT, SUGGEST, S_CHOOSE, S_CONFIRM, *NEW_CARDS, FOCUS, LOGO])), 'Key moments must sit on beats'
assert on_beat(DROP / 4) and on_beat(LOGO / 4), 'The drop and the logo hit start bars'

# i–VI–III–VII in D minor, one chord a bar, with Dm on the drop; the bar before the logo is C, resolving to F.
CHORDS = {'Dm': ([62, 65, 69, 72], 38), 'Bb': ([62, 65, 70, 74], 34), 'F': ([60, 65, 69, 72], 41), 'C': ([60, 64, 67, 71], 36)}
PROGRESSION = ['Dm', 'Bb', 'F', 'C']
DROP_BAR, LOGO_BAR = round(DROP / BAR), round(LOGO / BAR)
def chord(bar):
    return CHORDS['F' if bar >= LOGO_BAR else 'C' if bar == LOGO_BAR - 1 else PROGRESSION[(bar - DROP_BAR) % 4]]

def section(x):
    if x < BUILD: return 'intro'
    if x < DROP: return 'build'
    if x < GOALS: return 'groove'
    if x < LIGHT: return 'peak'
    if x < S_CONFIRM: return 'light'
    if x < FOCUS: return 'rebuild'
    if x < LOGO: return 'break'
    return 'logo'

kicks = []
for bar in range(int(np.ceil(DURATION / BAR))):
    t0 = bar * BAR
    notes, root = chord(bar)
    if bar < LOGO_BAR:
        bright = section(t0) == 'peak'
        place(music, pad(notes + ([notes[0] + 12] if bright else []), BAR + .6), t0, .05 if section(t0) in ('intro', 'build', 'break') else .042)
    for beat in range(4):
        tb = t0 + beat * BEAT
        if tb >= DURATION:
            break
        part = section(tb)
        if DROP - BEAT <= tb < DROP or LOGO - BEAT <= tb < LOGO:
            continue  # one beat of air before each hit
        grooving = part in ('groove', 'peak', 'light', 'rebuild')
        # The intro already grooves so the first seconds hold attention; the drop adds stabs, open hats and the card line on top.
        driving = grooving or part == 'intro'
        if part == 'intro':
            place(drums, KICK, tb, .58); kicks.append((tb, .4))
        elif part == 'build':
            place(drums, KICK, tb, .45); kicks.append((tb, .3))
        elif grooving:
            place(drums, KICK, tb, .6); kicks.append((tb, .45))
        elif part == 'break' and (beat == 0 or tb == FOCUS):
            place(drums, KICK, tb, .45); kicks.append((tb, .3))  # the breakdown opens on its own first beat
        if driving and beat in (1, 3):
            place(drums, CLAP, tb, .3 if grooving else .26, .05)
        if driving:
            for half in range(2):
                place(music, bass(root + (12 if beat == 3 and half == 1 else 0)), tb + half * BEAT / 2, .2)
        elif part == 'build' and beat in (0, 2):
            place(music, bass(root, .45), tb, .14)
        elif part == 'break' and (beat == 0 or tb == FOCUS):
            place(music, bass(root, 1.8 if beat == 0 else 1.0), tb, .16)
        if part == 'build' or driving:
            for half in range(2):
                if driving or half:
                    place(drums, HAT, tb + half * BEAT / 2, (.07 if half else .045) * (1.4 if part == 'peak' else 1), .25)
            if part in ('peak', 'rebuild') or DROP <= tb < DROP + BAR:
                place(drums, OPEN, tb + BEAT / 2, .045, -.2)
        if part in ('groove', 'peak', 'rebuild') and beat in (1, 3):
            place(music, stab(notes), tb + BEAT / 2, .05, .15)
# Sixteenth arpeggio across the chord at the peak and in the rebuild.
for step in range(int(DURATION / (BEAT / 4))):
    ts = step * BEAT / 4
    if section(ts) in ('peak', 'rebuild'):
        notes = chord(int(ts // BAR))[0]
        pattern = [notes[0], notes[1], notes[2], notes[3], notes[2] + 12, notes[3], notes[1] + 12, notes[2]]
        place(music, pluck(pattern[step % 8], .5, .7), ts, .016, (-.35, .35)[step % 2])

def roll(end, gain):
    # Eighths for a beat and a half, then sixteenths, stopping one beat before the hit.
    hits = [end - 2 * BEAT + i * BEAT / 4 for i in range(4)] if end - BUILD < 1 else [end - 3 * BEAT + i * BEAT / 2 for i in range(2)] + [end - 2 * BEAT + i * BEAT / 4 for i in range(4)]
    for i, x in enumerate(hits):
        place(drums, SNARE, x, gain + .025 * i)

# The first frame hits, and a syncopated hook rides the intro groove so the opening seconds have a tune.
place(drums, BOOM, 0, .38); place(drums, CRASH, 0, .09); place(drums, CLAP, 0, .2)
place(music, stab(chord(0)[0]), 0, .08)
for x, note in [(0, 74), (.25, 77), (.75, 81), (1.25, 79), (1.5, 77), (2.0, 72), (2.25, 77), (2.75, 81), (3.25, 84), (3.5, 81)]:
    if x < BUILD:
        place(accents, pluck(note, 1.2, 1.1), x, .045, .1)
roll(DROP, .08)
place(accents, pluck(57, 2.0), LIFT, .04, -.2)
place(drums, CRASH, DROP, .14); place(drums, CLAP, DROP, .25); place(drums, BOOM, DROP, .42)
for i, x in enumerate(CARDS):
    place(accents, pluck([62, 65, 67, 69, 72, 74, 77, 79, 81, 84, 86, 89][i], 1.0, 1.2), x, .02, -.5 + i / 11)
place(accents, pluck(69, 1.2), CARD_OPEN, .022)
place(accents, pluck(74, 1.4), CHOOSE, .03)
place(accents, pluck(62, 1.8), CONFIRM, .035); place(drums, CLAP, CONFIRM, .12)
for i in range(4):
    place(drums, SNARE, GOALS - BEAT + i * BEAT / 4, .08 + .03 * i)
for x, note in zip(ARRIVE, [77, 81]):
    place(accents, pluck(note, 1.2, 1.2), x, .028, .3)
for i in range(4):
    place(drums, SNARE, LIGHT - BEAT + i * BEAT / 4, .08 + .03 * i)
place(accents, pluck(81, 1.2), SUGGEST, .022)
place(accents, pluck(74, 1.4), S_CHOOSE, .03)
place(drums, CRASH, S_CONFIRM, .1); place(accents, pluck(62, 1.8), S_CONFIRM, .035)
for x, note in zip(NEW_CARDS, [74, 77, 81]):
    place(accents, pluck(note, 1.2, 1.2), x, .03, .3)
for i in range(4):
    place(drums, SNARE, FOCUS - BEAT + i * BEAT / 4, .08 + .03 * i)
roll(LOGO, .05)
place(drums, KICK, LOGO, .6); place(drums, CRASH, LOGO, .16); place(drums, BOOM, LOGO, .38); kicks.append((LOGO, .45))
place(music, pad([53, 60, 65, 69, 72, 76], DURATION - LOGO), LOGO, .07)
for x, note in [(0, 77), (.5, 81), (1.0, 84), (2.0, 81)]:
    place(accents, pluck(note, 1.8), LOGO + x, .028, .1)

# Kick-triggered ducking gives the pads and bass their pulse.
t = np.arange(N) / SR
duck = np.ones(N)
for x, depth in kicks:
    start = round(x * SR)
    duck[start:] = np.minimum(duck[start:], 1 - depth * np.exp(-np.arange(N - start) / SR / .11))
music *= duck[:, None]
# The build closes a low-pass over the band and the drop opens it again at once.
closed = np.clip((t - BUILD) / (DROP - BEAT - BUILD), 0, 1) ** 1.3 * (t < DROP) * .85
dark = np.stack([filt('lowpass', 900, music[:, c]) for c in range(2)], axis=1)
music = dark * closed[:, None] + music * (1 - closed)[:, None]
# Section dynamics follow the picture: back while a card is read, peak for the goals,
# back for the suggestion, rebuilding once it is confirmed.
# The intro grooves a little under the drop so the hit at the drop is still the high point.
dynamics = np.interp(t, [0, DROP - .01, DROP, DROP + BAR - BEAT / 2, DROP + BAR, CARD_OPEN, CARD_OPEN + BEAT, CONFIRM - BEAT / 2, CONFIRM, GOALS - BEAT / 2, GOALS, LIGHT - BEAT / 2, LIGHT, S_CONFIRM - BEAT / 2, S_CONFIRM, FOCUS - BEAT / 2, FOCUS],
                     [.86, .86, 1.08, 1.08, 1, 1, .7, .7, .88, .88, 1.06, 1.06, .68, .68, .96, .96, 1])
drums *= dynamics[:, None]
music *= dynamics[:, None]
rms = lambda bus: 20 * np.log10(np.sqrt(np.mean(bus[round(DROP * SR):round(FOCUS * SR)] ** 2)) + 1e-12)
print(json.dumps({'bus_rms_db_drop_to_focus': {'drums': round(rms(drums), 1), 'music': round(rms(music), 1), 'accents': round(rms(accents), 1)}}))
mixdown = drums + 1.4 * music + 3.0 * accents  # balance after the bus check: bed about 3 dB under the drums, event plucks audible
for delay, gain in [(.109, .06), (.173, .035)]:
    offset = round(delay * SR)
    mixdown[offset:] += (music + accents)[:-offset, ::-1] * gain
mixdown *= (np.clip(t / .02, 0, 1) * np.sin(np.pi * np.clip((DURATION - t) / 1.4, 0, 1) / 2) ** 2)[:, None]
mixdown /= np.max(np.abs(mixdown))
mixdown = np.tanh(1.5 * mixdown) / np.tanh(1.5)

spec = json.loads((ROOT / 'assets/narration-v3.json').read_text())
narrated = all((VOICE / f"{take['id']}.wav").exists() for take in spec['takes'])
target = -24.0 if narrated else -16.0
OUT.mkdir(parents=True, exist_ok=True)
write(OUT / 'v3-score-premaster.wav', mixdown * .5)
measured = levels(OUT / 'v3-score-premaster.wav')
mixdown *= .5 * 10 ** ((target - float(measured['input_i'])) / 20)
ceiling = 10 ** (-1.8 / 20)
mixdown = ceiling * np.tanh(mixdown / ceiling)
report = {'bpm': BPM, 'narrated': narrated, 'music_target_lufs': target, 'takes': []}
if narrated:
    voice = np.zeros_like(mixdown)
    duck_voice = np.ones(N)
    previous = 0
    for take in spec['takes']:
        source = VOICE / f"{take['id']}.wav"
        raw = run(['ffmpeg', '-loglevel', 'error', '-i', str(source), '-f', 'f32le', '-ac', '2', '-ar', str(SR), 'pipe:1']).stdout
        samples = np.frombuffer(raw, dtype='<f4').reshape(-1, 2).copy()
        window = SR // 100
        blocks = samples[:len(samples) // window * window].reshape(-1, window, 2)
        active = np.flatnonzero(np.sqrt(np.mean(blocks ** 2, axis=(1, 2))) > 10 ** (-48 / 20))
        samples = samples[max(0, active[0] * window - round(.08 * SR)):min(len(samples), (active[-1] + 1) * window + round(.15 * SR))]
        source_levels = levels(source)
        samples *= 10 ** (min(-16 - float(source_levels['input_i']), -3 - float(source_levels['input_tp'])) / 20)
        start, stop = round(take['at'] * SR), round(take['at'] * SR) + len(samples)
        assert start >= previous and stop / SR <= take['until'], f"Narration overrun: {take['id']} ends at {stop / SR:.2f}, deadline {take['until']}"
        previous = stop
        voice[start:stop] += samples
        duck_voice = np.minimum(duck_voice, np.interp(t, [max(0, take['at'] - .15), take['at'], stop / SR, min(DURATION, stop / SR + .3)], [1, .7, .7, 1], left=1, right=1))
        report['takes'].append({'id': take['id'], 'start': take['at'], 'end': stop / SR})
    mixdown = mixdown * duck_voice[:, None] + voice
assert np.max(np.abs(mixdown)) < .95, 'Mix needs more peak headroom'
name = 'v3-mix.wav' if narrated else 'v3-score.wav'
write(OUT / name, mixdown)
report['output'] = name
report['levels'] = levels(OUT / name)
(OUT / 'v3-audio-report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'output': name, 'lufs': report['levels']['input_i'], 'true_peak': report['levels']['input_tp'], 'lra': report['levels']['input_lra']}))
