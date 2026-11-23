#!/usr/bin/env bash
# Build "Little Duck" end to end (no paid services):
#   voice (edge-tts) -> rhythm-fit -> 3D frames (three.js in headless Chromium) -> mix -> mp4
set -euo pipefail
cd "$(dirname "$0")"
[ -f build/voice/line0.json ] || python3 make_voice.py build/voice      # needs internet (free Edge TTS)
python3 fit_voice.py
python3 mix_audio.py
python3 -m http.server 8765 --bind 127.0.0.1 >/dev/null 2>&1 & SERVER=$!
trap 'kill $SERVER' EXIT
sleep 1
NODE_PATH="$(npm root -g)" node render.js build/frames "${WORKERS:-3}"
ffmpeg -v error -y -framerate 30 -i build/frames/f%05d.png -i build/mix.wav \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -profile:v high -level 4.2 \
  -c:a aac -b:a 192k -ar 48000 -movflags +faststart -shortest \
  -metadata title="Little Duck" little_duck_3d.mp4
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,r_frame_rate,pix_fmt,sample_rate,channels -of compact little_duck_3d.mp4
