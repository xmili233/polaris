# Polaris launch audio sources

## Current v2

- `public/audio/narration.wav`: English narration generated with the Gemini Developer API, `gemini-3.8-flash-tts`, stock voice **Aoede**, selected by the user. The exact words, style, cues, model and returned usage are recorded in `assets/narration.json` and `out/narration/`. No voice cloning or local model was used. Provider terms apply: https://ai.google.dev/gemini-api/terms.
- `public/audio/score.wav`: Original synthesized composition, extending the accepted 15-second music study. D-minor/add9 and B-flat-major7/add9 pads, sparse rounded plucks and soft low pulses. Made by `scripts/make-launch-audio.py`; no reference recording or stock sample is used.
- No foley, brushing, whooshes, click samples, or separate air/noise bed are included in v2. The no-music version retains only narration.

## Historical v1 (rejected sound direction)

These files remain for the historical v1 and are not used by v2. Source names and license labels follow video-shotcraft's audio catalog at commit `43bd349a136651865ecfa6ea1cf012f6e957d304`.

| Local file | Original asset | Creator | Source | Catalog license |
| --- | --- | --- | --- | --- |
| `public/audio/music.mp3` | House Vibez | Lily J | https://assets.mixkit.co/music/745/745.mp3 | Mixkit Stock Music Free License |
| `public/audio/transition.mp3` | Air zoom vacuum | Mixkit | https://assets.mixkit.co/active_storage/sfx/2608/2608-preview.mp3 | Mixkit Sound Effects Free License |
| `public/audio/swoosh.mp3` | Fast small sweep transition | Mixkit | https://assets.mixkit.co/active_storage/sfx/166/166-preview.mp3 | Mixkit Sound Effects Free License |
| `public/audio/click.mp3` | Quick switch click | Mixkit | https://assets.mixkit.co/active_storage/sfx/2582/2582-preview.mp3 | Mixkit Sound Effects Free License |

License texts: https://mixkit.co/license/#musicFree and https://mixkit.co/license/#sfxFree.

Music fades in and out at low volume. The alternative MP4 removes only the music; all operation sounds remain. Both files share the exact same encoded video stream.
