# Little Duck — 3D nursery-rhyme Short, made entirely by code

Output: `little_duck_3d.mp4` — 1080×1920, 30 fps, 22.8 s, H.264 (crf 18, yuv420p) + AAC 192k.

| Step | Script | What it does |
|---|---|---|
| Voice | `make_voice.py` | Free Edge neural TTS (`en-US-AnaNeural`, child voice) for the 8 lyric lines + "Goodnight, Little Duck!", with word timestamps |
| Rhythm fit | `fit_voice.py` | Cuts every word and places it on a 100 BPM 16th-note grid, so each line fills its 2.4 s slot and starts on the downbeat (rubberband time-compress ≤1.35×) → `build/voice_track.wav`, `build/words.json` |
| 3D | `scene/main.js` | three.js scene, a pure function of time: Sketchfab duck recolored by code, 3D eyes + eyelids, head-hugging blue rain hood, squash & stretch hops, waddle with tilt, head droop + eyes closing; puddle ripple shader, splash particles, rain, day → storm → night sky, sun, clouds, moon, stars, fireflies; karaoke captions (Poppins Bold, active word #FFD63A, kept above the bottom 15 %), title, "Quack!" bubble, Z's, end card |
| Frames | `render.js` | Headless Chromium (SwiftShader WebGL), 684 frames → `build/frames/` |
| Audio | `mix_audio.py` | Beat-matched music (101 → 100 BPM), voice side-chain ducking (−8 dB), SFX on the animation events, synthesized whoosh & twinkles, night low-pass, 0.7 s fade, loudness −14 LUFS / −1.5 dBTP |
| All | `make.sh` | Runs everything and encodes with ffmpeg |

Animation and sound share one timeline: the hop landings, splashes, quack bubble, plops and the five
rain hops are taken from the sung word times in `build/words.json`.

Swap in another music file (e.g. a track you downloaded from Pixabay yourself):
`MUSIC_FILE=assets/music/your.mp3 MUSIC_DOWNBEAT=<seconds of a bar start> ./make.sh`

Credits and licenses: see `credits.txt`. Upload text, tags and checklist: `youtube_metadata.md`.
