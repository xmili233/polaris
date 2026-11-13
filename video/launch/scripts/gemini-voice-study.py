"""Generate two narration takes through Gemini's hosted TTS API.

Set GEMINI_API_KEY, or supply --key-file pointing to a private file outside the repo.
Only the public script, voice names, and returned usage are recorded with the audio.
"""
import argparse
import base64
import json
import os
import time
from pathlib import Path
import urllib.error
import urllib.request
import wave

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'out' / 'voice-study'
TEXT = ('One goal. Multiple strategies, moving in parallel. '
        'Your agents bring the context and the options. '
        'You make the decisions, and keep the work moving.')
STYLE = ('Natural American English narration for a thoughtful software product film. '
         'Calm, clear, conversational, quietly confident. Moderate pace, around 145 words per minute. '
         'Short natural pauses between sentences. No announcer voice, whispering, or theatrical emphasis.')
VOICES = ['Charon', 'Aoede']
ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions'

parser = argparse.ArgumentParser()
parser.add_argument('--key-file', type=Path)
parser.add_argument('--model', default='gemini-3.8-flash-tts')
parser.add_argument('--script', type=Path, help='Timed full-film narration JSON; omit for the original voice study')
args = parser.parse_args()
narration = json.loads(args.script.read_text()) if args.script else None
if narration:
    OUT = ROOT / 'out' / narration['output']
    takes = [{**take, 'voice': narration['voice']} for take in narration['takes']]
    assert len({take['id'] for take in takes}) == len(takes)
    for i, take in enumerate(takes):
        assert 0 <= take['at'] < take['until'] <= narration['duration_seconds']
        assert i == 0 or takes[i-1]['until'] <= take['at']
        assert take['id'].replace('-', '').isalnum() and take['text'].strip()
else:
    takes = [{'id': voice.lower(), 'voice': voice, 'text': TEXT} for voice in VOICES]
key = os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY')
if not key and args.key_file:
    key = args.key_file.read_text().strip()
if not key:
    parser.error('Set GEMINI_API_KEY or provide --key-file. Never put the key in this script.')
OUT.mkdir(parents=True, exist_ok=True)
spec = {'model': args.model, 'text': TEXT, 'style': STYLE, 'voices': VOICES,
        'provider': 'Gemini Developer API', 'voice_start_seconds': .6, 'preview_seconds': 15,
        'source': 'https://ai.google.dev/gemini-api/docs/speech-generation'}
if narration:
    spec = {'model': args.model, 'style': STYLE, 'takes': takes,
            'duration_seconds': narration['duration_seconds'], 'provider': 'Gemini Developer API',
            'source': spec['source']}
(OUT / 'spec.json').write_text(json.dumps(spec, indent=2) + '\n')

for take in takes:
    voice, spoken_text = take['voice'], take['text']
    output = OUT / (take['id'] + '.wav')
    if output.exists():
        if narration:
            saved = json.loads(output.with_suffix('.json').read_text())
            if any(saved.get(field) != expected for field, expected in
                   [('voice', voice), ('text', spoken_text), ('model', args.model)]):
                raise SystemExit(f"{take['id']}: existing audio does not match the script; preserve it elsewhere before regenerating")
        print(f"{take['id']}: already generated; keeping the existing take", flush=True)
        continue
    payload = {'model': args.model,
               'input': [{'type': 'user_input', 'content': [
                   {'type': 'text', 'text': spoken_text,
                    'annotations': [{'type': 'speech_metadata', 'style': STYLE}]}]}],
               'response_format': {'type': 'audio'},
               'generation_config': {'speech_config': [{'voice': voice}]}}
    request = urllib.request.Request(ENDPOINT, data=json.dumps(payload).encode(),
                                    headers={'x-goog-api-key': key, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        message = error.read().decode(errors='replace').replace(key, '[redacted]')
        raise SystemExit(f"Gemini HTTP {error.code}: {message[:2500]}")
    audio = [item for step in result.get('steps', []) if step.get('type') == 'model_output'
             for item in step.get('content', []) if item.get('type') == 'audio' and item.get('data')]
    if not audio:
        raise SystemExit(f'No audio returned for {voice}; response fields: {list(result)}')
    raw = base64.b64decode(audio[-1]['data'], validate=True)
    if not raw.startswith(b'RIFF'):
        raise SystemExit(f'{voice}: expected WAV response, received a different audio container')
    output.write_bytes(raw)
    with wave.open(str(output)) as wav:
        duration = wav.getnframes() / wav.getframerate()
        if not 1 <= duration <= 30:
            raise SystemExit(f'{voice}: unexpected duration {duration:.2f}s')
    metadata = {'id': result.get('id'), 'voice': voice, 'duration_seconds': duration,
                'text': spoken_text, 'usage': result.get('usage'), 'model': args.model}
    (OUT / (take['id'] + '.json')).write_text(json.dumps(metadata, indent=2) + '\n')
    print(f"{take['id']} ({voice}): {duration:.2f}s WAV saved", flush=True)
    if take is not takes[-1]:
        time.sleep(20)
