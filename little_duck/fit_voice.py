"""Fit the edge-tts lyric lines into their 2.4 s slots.

Each word is cut out at its WordBoundary timestamp and re-placed on a 100 BPM
16th-note grid (0.15 s), so every line starts on the musical downbeat and the
repeated words (splash / quack / plop / hop) land evenly on the beat.  Words that
are longer than the space they get are time-compressed with ffmpeg's rubberband
filter (pitch preserved, max 1.35x) and, if still too long, their tail is faded.

Writes build/voice_track.wav (48 kHz mono, 22.8 s) and build/words.json.
"""
import json, os, subprocess, tempfile
import numpy as np, soundfile as sf

SR = 48000
DUR = 22.8
S16 = 0.15                      # one 16th note at 100 BPM
SLOT0, SLOT = 1.2, 2.4
VOICE_DIR = "build/voice"

# onset of every word inside its slot, in 16ths (None = keep natural timing)
RHYTHM = {
    0: [0, 2, 4, 6, 8, 10.67, 13.33],          # Lit-tle Duck, Lit-tle Duck, SPLASH SPLASH SPLASH
    1: None,
    2: [0, 2, 4, 6, 8, 10.67, 13.33],          # ... QUACK QUACK QUACK
    3: None,
    4: [0, 2, 4, 8, 12],                       # Rain goes PLOP . PLOP . PLOP (on beats 2,3,4)
    5: [0, 3, 6, 9, 12],                       # HOP HOP HOP HOP HOP (even dotted-8ths)
    6: [0, 2, 4, 6, 8, 10, 12],                # Little Duck, Little Duck, time for bed
    7: None,
    8: None,
}
SLOT_START = [SLOT0 + i * SLOT for i in range(8)] + [20.55]
SLOT_LIMIT = [s + SLOT - 0.12 for s in SLOT_START[:8]] + [22.05]   # leave a breath / end before fade


def load(path):
    with tempfile.NamedTemporaryFile(suffix=".wav") as t:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", path, "-ac", "1", "-ar", str(SR), t.name], check=True)
        x, _ = sf.read(t.name, dtype="float32")
    return x


def stretch(x, ratio):
    """time-compress x by `ratio` (>1 = shorter) with rubberband, pitch kept."""
    with tempfile.TemporaryDirectory() as d:
        a, b = f"{d}/a.wav", f"{d}/b.wav"
        sf.write(a, x, SR)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", a, "-af",
                        f"rubberband=tempo={ratio:.4f}:transients=crisp:detector=compound:window=short",
                        b], check=True)
        y, _ = sf.read(b, dtype="float32")
    return y


def fade(x, fin=0.006, fout=0.02):
    x = x.copy()
    n1, n2 = min(len(x), int(fin * SR)), min(len(x), int(fout * SR))
    if n1: x[:n1] *= np.linspace(0, 1, n1)
    if n2: x[-n2:] *= np.linspace(1, 0, n2) ** 1.5
    return x


def main():
    track = np.zeros(int(DUR * SR), np.float32)
    words_out = []
    for li in range(9):
        meta = json.load(open(f"{VOICE_DIR}/line{li}.json"))
        x = load(f"{VOICE_DIR}/line{li}.mp3")
        # loudness-match lines (RMS of voiced part)
        voiced = x[np.abs(x) > 0.02]
        x = x * (0.12 / (np.sqrt(np.mean(voiced ** 2)) + 1e-9))
        W = meta["words"]
        n = len(W)
        starts = [w["start"] for w in W]
        ends = [w["start"] + w["dur"] for w in W]
        slot0, limit = SLOT_START[li], SLOT_LIMIT[li]

        if RHYTHM[li] is not None:
            onsets = [slot0 + r * S16 for r in RHYTHM[li]]
        else:
            # natural timing, squeeze pauses > 70 ms, then scale to fit the slot
            rel = [0.0]
            for i in range(1, n):
                gap = starts[i] - ends[i - 1]
                gap = min(gap, 0.07) if gap > 0.07 else gap
                rel.append(rel[-1] + (ends[i - 1] - starts[i - 1]) + max(gap, 0.0))
            span = rel[-1] + (ends[-1] - starts[-1])
            k = min(1.0, (limit - slot0) / span)
            onsets = [slot0 + r * k for r in rel]

        for i, w in enumerate(W):
            pre = 0.015
            a = max(0.0, starts[i] - pre)
            b_nat = ends[i] + (0.12 if i == n - 1 else 0.05)
            b = min(b_nat, starts[i + 1] - 0.005) if i < n - 1 else b_nat
            seg = x[int(a * SR):int(b * SR)]
            nxt = onsets[i + 1] if i < n - 1 else limit + 0.1
            avail = nxt - onsets[i] - 0.012 + pre
            ratio = 1.0
            if len(seg) / SR > avail:
                ratio = min(1.35, (len(seg) / SR) / avail)
                if ratio > 1.03:
                    seg = stretch(seg, ratio)
                if len(seg) / SR > avail:
                    seg = seg[:int(avail * SR)]
            seg = fade(seg, fout=0.03 if ratio > 1.0 else 0.02)
            p = int((onsets[i] - pre) * SR)
            track[p:p + len(seg)] += seg[:len(track) - p]
            words_out.append({"line": li, "i": i, "word": w["word"], "t0": round(onsets[i], 3),
                              "t1": round(onsets[i] - pre + len(seg) / SR, 3), "stretch": round(ratio, 3)})

    # gentle high-pass + presence boost for a bright, clear kid voice
    sf.write("build/voice_raw.wav", track, SR)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", "build/voice_raw.wav", "-af",
                    "highpass=f=110,equalizer=f=3200:t=q:w=1.2:g=3,acompressor=threshold=-20dB:ratio=3:attack=5:release=80",
                    "-ar", str(SR), "build/voice_track.wav"], check=True)
    json.dump(words_out, open("build/words.json", "w"), indent=1)
    for li in range(9):
        ws = [w for w in words_out if w["line"] == li]
        print(li, f"{ws[0]['t0']:.2f}-{ws[-1]['t1']:.2f}", " ".join(f"{w['word']}@{w['t0']:.2f}{'*' if w['stretch'] > 1 else ''}" for w in ws))


if __name__ == "__main__":
    main()
