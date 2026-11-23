"""Place the narration lines on the timeline (dramatic pauses from script.py) and export word timings.

Writes build/narration_dry.wav (48 kHz mono) and build/timeline.json:
  {"duration": D, "lines": [{"i", "text", "style", "t0", "t1", "words": [{"word", "t0", "t1"}]}]}
The animation (scene/main.js) and the sound design (mix_audio.py) both read timeline.json.
"""
import io, json, subprocess
import numpy as np, soundfile as sf
from script import LINES, END_PAD

SR = 48000
MIN_GAP = 0.22


def load(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "wav", "-"],
                         capture_output=True, check=True).stdout
    x, _ = sf.read(io.BytesIO(raw), dtype="float64")
    return x


def main():
    clips, lines, t_prev_end = [], [], 0.0
    for i, (text, plan, _, _, style) in enumerate(LINES):
        meta = json.load(open(f"build/voice/line{i:02d}.json"))
        x = load(f"build/voice/line{i:02d}.mp3")
        env = np.convolve(np.abs(x), np.ones(480) / 480, mode="same")
        on = np.where(env > 0.004)[0]
        a = max(0, on[0] - int(0.03 * SR)); b = min(len(x), on[-1] + int(0.12 * SR))
        x = x[a:b]
        lead = a / SR
        start = max(plan, t_prev_end + MIN_GAP)
        words = [{"word": w["word"], "t0": round(start + w["start"] - lead, 3),
                  "t1": round(start + w["start"] - lead + w["dur"], 3)} for w in meta["words"]]
        end = start + len(x) / SR
        clips.append((start, x))
        lines.append({"i": i, "text": text, "style": style, "t0": round(start, 3), "t1": round(end, 3), "words": words})
        t_prev_end = end
    duration = round(t_prev_end + END_PAD, 2)
    out = np.zeros(int(duration * SR) + 1)
    for s, x in clips:
        p = int(s * SR); out[p:p + len(x)] += x[: len(out) - p]
    sf.write("build/narration_dry.wav", out.astype(np.float32), SR)
    json.dump({"duration": duration, "lines": lines}, open("build/timeline.json", "w"), indent=1)
    for l in lines:
        print(f"{l['t0']:6.2f}-{l['t1']:6.2f}  {l['text']}")
    print("duration", duration)


if __name__ == "__main__":
    main()
