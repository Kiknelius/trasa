#!/usr/bin/env bash
# Build "Never Count the People in the Mirror": voice -> timeline -> mix -> frames -> mp4 (no paid services)
set -euo pipefail
cd "$(dirname "$0")"
[ -f build/voice/line00.json ] || python3 make_voice.py build/voice        # needs internet (free Edge TTS)
python3 build_timeline.py
python3 mix_audio.py
python3 -m http.server 8766 --bind 127.0.0.1 >/dev/null 2>&1 & SERVER=$!
trap 'kill $SERVER' EXIT
sleep 1
NODE_PATH="$(npm root -g)" node render.js build/frames "${WORKERS:-2}"
ffmpeg -v error -y -framerate 30 -i build/frames/f%05d.png -i build/mix.wav \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -profile:v high -level 4.2 \
  -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest \
  -metadata title="Never Count the People in the Mirror" stick_horror_mirror.mp4
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,r_frame_rate -of compact stick_horror_mirror.mp4
