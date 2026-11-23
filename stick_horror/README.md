# Never Count the People in the Mirror: stick-man horror Short, made entirely by code

Output: `stick_horror_mirror.mp4`: 1080×1920, 30 fps, 47.7 s, H.264 crf 18 + AAC 192k, −14 LUFS.

| Step | File | What it does |
|---|---|---|
| Story | `script.py` | Original 24-line story, with the planned beat for each line and voice prosody |
| Voice | `make_voice.py` | Free edge-tts narration (`en-US-ChristopherNeural`) with word timings |
| Timeline | `build_timeline.py` | Places the lines with dramatic pauses and writes `build/timeline.json` (drives picture and sound) |
| Picture | `scene/main.js` | Canvas 2D: candle-lit room, mirror with reflection, the "others" (long limbs, eyes), reverse hallway shot, blackout, the swap, smile/eyes reveal. Also film grain, vignette, glitch, whip pans, red word-by-word captions and count numerals |
| Frames | `render.js` | Headless Chromium → `build/frames/` |
| Sound | `mix_audio.py` | Deepened voice + room, whisper with reverse swell, drone + CC0 ambience, synthesized stings/risers/match/puff/hum, CC0 heartbeat/knocks/door/switch, voice ducking, −14 LUFS |
| All | `make.sh` | Runs the whole pipeline and encodes |

Credits: `credits.txt`. Title/description/tags: `youtube_metadata.md`.
