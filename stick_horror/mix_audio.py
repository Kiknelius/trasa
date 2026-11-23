"""Sound design + mix for "Never Count the People in the Mirror".

All cue times come from build/timeline.json (same cues as scene/main.js).
Recorded SFX: CC0 (OpenGameArt). Drone, stings, risers, match, puff, hum, whooshes: synthesized here.
Output: build/mix.wav (48 kHz stereo, -14 LUFS, TP -1.5 dB) + build/mix_report.json
"""
import io, json, os, subprocess, tempfile
import numpy as np, soundfile as sf
from scipy.signal import butter, sosfiltfilt, fftconvolve

SR = 48000
A = "assets/sfx"
TL = json.load(open("build/timeline.json"))
DUR = TL["duration"]; N = int(DUR * SR)
tt = np.arange(N) / SR
rng = np.random.default_rng(7)


# ------------------------------------------------------------------ helpers
def load(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "wav", "-"], capture_output=True, check=True).stdout
    x, _ = sf.read(io.BytesIO(raw), dtype="float64"); return x

def ffx(x, af):
    with tempfile.TemporaryDirectory() as d:
        sf.write(f"{d}/a.wav", x.astype(np.float32), SR)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", f"{d}/a.wav", "-af", af, "-ar", str(SR), "-ac", "1", f"{d}/b.wav"], check=True)
        y, _ = sf.read(f"{d}/b.wav", dtype="float64")
    return y

def bp(x, lo, hi, order=2):
    return sosfiltfilt(butter(order, [lo, hi], btype="band", fs=SR, output="sos"), x)

def lp(x, f, order=2):
    return sosfiltfilt(butter(order, f, btype="low", fs=SR, output="sos"), x)

def hp(x, f, order=2):
    return sosfiltfilt(butter(order, f, btype="high", fs=SR, output="sos"), x)

def norm(x, p=0.9):
    return x * (p / (np.abs(x).max() + 1e-9))

def place(buf, x, t, db=0.0, pan=0.0):
    i = int(round(t * SR))
    if i >= len(buf) or i + len(x) <= 0: return
    if i < 0: x = x[-i:]; i = 0
    x = x[: len(buf) - i] * 10 ** (db / 20)
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    buf[i:i + len(x), 0] += x * l * np.sqrt(2); buf[i:i + len(x), 1] += x * r * np.sqrt(2)

def env_ar(n, a, r):
    t = np.arange(n) / SR
    return np.minimum(1, t / max(a, 1e-4)) * np.exp(-t / r)

def sstep(e0, e1, t):
    u = np.clip((t - e0) / (e1 - e0), 0, 1); return u * u * (3 - 2 * u)

def reverb_ir(sec=2.2, damp=3.0):
    n = int(sec * SR); t = np.arange(n) / SR
    ir = rng.standard_normal(n) * np.exp(-t * damp)
    ir = lp(ir, 5000); ir[0] = 1.0
    return ir / np.sqrt(np.sum(ir ** 2))

def reverb(x, wet=0.35, sec=2.2, damp=3.0):
    y = fftconvolve(x, reverb_ir(sec, damp))[: len(x) + int(sec * SR)]
    out = np.zeros(len(y)); out[: len(x)] = x * (1 - wet)
    return out + y * wet


# ------------------------------------------------------------------ cues (mirror scene/main.js)
L = TL["lines"]
clean = lambda s: "".join(ch for ch in s.lower() if ch.isalpha() or ch == "'")
def wordT(i, w): return next(x["t0"] for x in L[i]["words"] if clean(x["word"]) == w)
CUE = dict(
    powerOut=wordT(2, "out") + 0.1, match=L[3]["t0"] + 0.42, flick0=L[6]["t0"], fig2=L[7]["t0"] - 0.1,
    turn=wordT(8, "around") - 0.05, door=L[9]["t0"] + 0.15, cut2=wordT(10, "back") + 0.05, fig3=L[11]["t0"] - 0.1,
    closer0=L[12]["t0"], raise_=wordT(13, "raised"), smile=L[16]["t0"] - 0.05, out=wordT(17, "out") + 0.18,
    lightBack=wordT(18, "back") + 0.02, pickup=L[21]["t0"] + 0.05, turn2=L[22]["t0"] + 0.05, final=L[23]["t0"])
CUE["cut1"] = CUE["turn"] + 0.3
CUE["knocks"] = [L[18]["t1"] + 0.04, L[19]["t1"] + 0.06, L[19]["t1"] + 0.3, L[19]["t1"] + 0.54]   # in the pauses
END = DUR - 0.5


# ------------------------------------------------------------------ synth sounds
def sting(seed=1, dur=2.6, base=110.0):
    r = np.random.default_rng(seed); n = int(dur * SR); t = np.arange(n) / SR
    x = np.zeros(n)
    for k, ratio in enumerate([1, 1.059, 1.414, 1.498, 2.0 * 1.059, 2.83]):     # minor 2nds + tritone cluster
        f = base * ratio * (1 + 0.004 * r.standard_normal())
        saw = 2 * ((t * f + r.random()) % 1) - 1
        x += saw * (0.6 if k < 3 else 0.35)
    x = lp(x, 2600) * env_ar(n, 0.006, 0.9)
    sub = np.sin(2 * np.pi * (45 * t - 20 * t ** 2)) * env_ar(n, 0.003, 0.5)
    hit = bp(r.standard_normal(n), 200, 3000) * env_ar(n, 0.001, 0.07)
    y = reverb(norm(x) * 0.6 + sub * 0.9 + hit * 0.5, wet=0.4, sec=2.5)
    return norm(y[: int((dur + 1.5) * SR)], 0.9)

def riser(dur=0.9, seed=2):
    n = int(dur * SR); t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    for fc in (300, 600, 1200, 2400, 4800):
        w = np.exp(-((t / dur - np.log2(fc / 300) / 4) ** 2) / 0.05)
        out += bp(noise, fc * 0.7, min(fc * 1.4, 20000)) * w
    return norm(out * (t / dur) ** 2, 0.7)

def whoosh(dur=0.45):
    n = int(dur * SR); t = np.arange(n) / SR; noise = rng.standard_normal(n); out = np.zeros(n)
    for fc in (300, 700, 1500, 3000):
        out += bp(noise, fc * 0.7, fc * 1.4) * np.exp(-((np.sin(np.pi * t / dur) - np.log2(fc / 300) / 3.3) ** 2) / 0.08)
    return norm(out * np.sin(np.pi * t / dur) ** 1.5, 0.7)

def match_strike():
    n = int(0.55 * SR); t = np.arange(n) / SR
    scrape = bp(rng.standard_normal(n), 1800, 7000) * np.exp(-((t - 0.06) / 0.05) ** 2)
    flare = bp(rng.standard_normal(n), 400, 3000) * env_ar(n, 0.02, 0.18) * (t > 0.08)
    crack = np.zeros(n)
    for k in range(18):
        i = int((0.08 + rng.random() * 0.4) * SR); crack[i:i + 60] += rng.standard_normal(60) * np.exp(-np.arange(60) / 12) * rng.random()
    return norm(scrape * 0.8 + flare * 0.6 + hp(crack, 2000) * 0.5, 0.8)

def crackle(dur):
    n = int(dur * SR); x = np.zeros(n)
    for k in range(int(dur * 25)):
        i = int(rng.random() * (n - 80)); x[i:i + 80] += rng.standard_normal(80) * np.exp(-np.arange(80) / 15) * rng.random()
    return norm(hp(x, 1500), 0.5)

def puff():
    n = int(0.45 * SR); t = np.arange(n) / SR
    return norm(lp(rng.standard_normal(n), 900) * np.sin(np.pi * np.clip(t / 0.4, 0, 1)) ** 2, 0.8)

def hum(dur, lvl):
    t = np.arange(int(dur * SR)) / SR
    x = sum(np.sin(2 * np.pi * 50 * k * t) / k ** 1.3 for k in range(1, 9)) + 0.05 * bp(rng.standard_normal(len(t)), 2000, 6000)
    return norm(x, 0.5) * lvl

def drone(n):
    t = np.arange(n) / SR
    x = (np.sin(2 * np.pi * 41.2 * t) + 0.8 * np.sin(2 * np.pi * 41.9 * t) + 0.5 * np.sin(2 * np.pi * 61.7 * t + np.sin(t * 0.3))
         + 0.25 * np.sin(2 * np.pi * 87.3 * t) * (0.5 + 0.5 * np.sin(t * 0.7)))
    air = bp(rng.standard_normal(n), 200, 900) * (0.4 + 0.3 * np.sin(t * 0.21))
    return norm(x * 0.8 + air * 0.25, 0.8)

def cold_pad(n):   # after the swap: high glassy cluster
    t = np.arange(n) / SR
    x = sum(np.sin(2 * np.pi * f * t + k) * (0.5 + 0.5 * np.sin(t * (0.4 + k * 0.13))) for k, f in enumerate([1244.5, 1318.5, 1864.7, 1975.5]))
    return norm(x, 0.6)


def main():
    # ---------------- voice: deeper, a little room; the last "One." becomes a whisper with a reverse swell
    v = load("build/narration_dry.wav")[:N]; v = np.pad(v, (0, N - len(v)))
    last = L[-1]; a, b = int((last["t0"] - 0.05) * SR), int((last["t1"] + 0.1) * SR)
    one = v[a:b].copy(); v[a:b] = 0
    v = ffx(v, "rubberband=pitch=0.93:formant=preserved,equalizer=f=140:t=q:w=1:g=3,equalizer=f=3000:t=q:w=1.5:g=2,"
               "lowpass=f=9500,acompressor=threshold=-22dB:ratio=3:attack=8:release=120")[:N]
    v = np.pad(v, (0, max(0, N - len(v))))
    v = reverb(v, wet=0.16, sec=1.2, damp=5.0)[:N]
    one = ffx(one, "rubberband=pitch=0.88:formant=preserved,highpass=f=150,equalizer=f=3500:t=q:w=1:g=4")
    one_w = reverb(norm(one, 0.6), wet=0.32, sec=2.6, damp=1.8)
    swell = reverb(norm(one, 0.6), wet=1.0, sec=1.6, damp=2.2)[::-1]
    voice = np.zeros((N, 2))
    place(voice, v, 0.0, 0)
    place(voice, swell, last["t0"] - 0.05 - len(swell) / SR, -17)
    place(voice, one_w, last["t0"] - 0.05, 5)

    # ---------------- bed: drone + horror ambience (grows with the story), cold pad after the swap
    bed = np.zeros((N, 2))
    d = drone(N)
    grow = 0.35 + 0.65 * sstep(CUE["fig2"] - 1, CUE["smile"], tt)
    gap = 1 - 0.85 * ((tt >= CUE["out"]) & (tt < CUE["lightBack"]))          # nearly silent blackout
    fade = 1 - sstep(END - 0.15, END + 0.2, tt)
    place(bed, d * grow * gap * fade, 0, -14)
    amb = load(f"{A}/ambient_horror.ogg"); amb = norm(amb, 0.8)
    xf = int(1.5 * SR); loop = amb.copy()
    while len(loop) < N:
        w = np.linspace(0, 1, xf); loop = np.concatenate([loop[:-xf], loop[-xf:] * (1 - w) + amb[:xf] * w, amb[xf:]])
    place(bed, loop[:N] * gap * fade * (0.5 + 0.5 * sstep(4, 10, tt)), 0, -20)
    pad = cold_pad(N) * sstep(CUE["lightBack"], CUE["lightBack"] + 1.5, tt) * fade
    place(bed, pad, 0, -30)

    # ---------------- sfx
    sfx = np.zeros((N, 2))
    place(sfx, hum(CUE["powerOut"], 1.0) * np.where(tt[: int(CUE["powerOut"] * SR)] > CUE["powerOut"] - 1.0,
          (np.sin(tt[: int(CUE["powerOut"] * SR)] * 47) > -0.1) * 1.0, 1.0), 0, -27)
    place(sfx, norm(load(f"{A}/light_switch_turn_off_0.mp3")), CUE["powerOut"] - 0.02, -12)
    place(sfx, norm(lp(load(f"{A}/noise_01.ogg"), 3000), 0.6), CUE["powerOut"], -22)
    place(sfx, match_strike(), CUE["match"] - 0.05, -10, pan=0.2)
    cr = crackle(DUR - CUE["match"] - 0.3); tc = CUE["match"] + 0.3 + np.arange(len(cr)) / SR
    place(sfx, cr * ((tc < CUE["out"]) | (tc > CUE["lightBack"])) * (tc < END), CUE["match"] + 0.3, -36, pan=0.15)
    place(sfx, crackle(2.2), CUE["flick0"], -24, pan=0.2)                       # the candle flickers
    CUE["finalHit"] = CUE["final"] + 0.5
    for i, k in enumerate(["fig2", "fig3", "smile", "lightBack", "finalHit"]):
        db = (-11, -10, -8, -9, -7)[i]
        place(sfx, riser(0.8 if k != "finalHit" else 1.2), CUE[k] - (0.8 if k != "finalHit" else 1.2), db - 6)
        place(sfx, sting(seed=i + 3, base=(110, 98, 87.3, 103.8, 73.4)[i]), CUE[k], db)
    place(sfx, norm(load(f"{A}/weird_04.ogg"), 0.7), CUE["fig2"] + 0.05, -16, pan=0.4)
    place(sfx, norm(load(f"{A}/weird_02.ogg"), 0.7), CUE["fig3"] + 0.05, -16, pan=-0.4)
    for c, p in ((CUE["cut1"], -0.5), (CUE["cut2"], 0.5)):
        place(sfx, whoosh(0.42), c - 0.21, -11, pan=p)
    place(sfx, norm(load(f"{A}/door_01.ogg"), 0.7), CUE["door"], -15, pan=-0.1)
    hb = norm(load(f"{A}/heartbeat_slow_reverb.wav"), 0.9)
    t = CUE["closer0"]; per = 1.05
    while t < CUE["lightBack"] + 0.3:
        dark = CUE["out"] <= t < CUE["lightBack"]
        place(sfx, hb, t, -9 if dark else -15)
        per = max(0.62, per * 0.95); t += per
    place(sfx, puff(), CUE["out"] - 0.12, -12)
    place(sfx, norm(load(f"{A}/noise_02.ogg"), 0.8), CUE["lightBack"], -12)
    for i, k in enumerate(CUE["knocks"]):
        g = lp(norm(load(f"{A}/glass_0{1 + i % 3}.ogg")), 2200)
        w = lp(norm(load(f"{A}/wooden_0{1 + i % 3}.ogg")), 900)
        n_ = max(len(g), len(w)); g = np.pad(g, (0, n_ - len(g))); w = np.pad(w, (0, n_ - len(w)))
        place(sfx, norm(g * 0.7 + w * 0.6), k - 0.01, -8, pan=-0.05)
    place(sfx, norm(lp(load(f"{A}/glass_04.ogg"), 4000), 0.6), CUE["pickup"] + 0.35, -24, pan=-0.3)
    place(sfx, riser(1.4), CUE["turn2"], -16)

    # ---------------- duck the bed under the voice, sum, normalise
    ve = np.abs(voice[:, 0]); k = int(0.03 * SR); ve = np.convolve(ve, np.ones(k) / k, mode="same")
    ve = np.clip(ve / (np.percentile(ve[ve > 1e-4], 90) + 1e-9), 0, 1)
    duck = 10 ** (-6 * ve / 20)
    os.makedirs("build/stems", exist_ok=True)
    duck_fx = 10 ** (-8 * ve / 20)
    stems = {"voice": voice, "bed": bed * duck[:, None], "sfx": sfx * duck_fx[:, None]}
    for n_, x in stems.items(): sf.write(f"build/stems/{n_}.wav", x.astype(np.float32), SR, subtype="FLOAT")
    mix = stems["voice"] * 1.0 + stems["bed"] * 0.8 + stems["sfx"] * 0.75
    sf.write("build/mix_pre.wav", mix.astype(np.float32), SR, subtype="FLOAT")
    ln = subprocess.run(["ffmpeg", "-hide_banner", "-i", "build/mix_pre.wav", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], capture_output=True, text=True).stderr
    meas = json.loads(ln[ln.rindex("{"):ln.rindex("}") + 1])
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", "build/mix_pre.wav", "-af",
                    f"loudnorm=I=-14:TP=-1.5:LRA=11:measured_I={meas['input_i']}:measured_TP={meas['input_tp']}:measured_LRA={meas['input_lra']}"
                    f":measured_thresh={meas['input_thresh']}:offset={meas['target_offset']}:linear=true,aresample=48000",
                    "-ar", str(SR), "-c:a", "pcm_s24le", "build/mix.wav"], check=True)
    final, _ = sf.read("build/mix.wav", dtype="float64")
    rep = {"final_peak_dbfs": float(20 * np.log10(np.abs(final).max())), "len_s": len(final) / SR,
           "clipped": int(np.sum(np.abs(final) >= 0.999)), "loudnorm_in": meas["input_i"], "lines": []}
    bg = stems["bed"] * 0.8 + stems["sfx"] * 0.75
    for ln_ in L:
        a, b = int(ln_["t0"] * SR), int(ln_["t1"] * SR); vv = stems["voice"][a:b]; act = np.abs(vv[:, 0]) > 0.01
        if act.sum() < 100: continue
        rv = np.sqrt(np.mean(vv[act] ** 2)); rb = np.sqrt(np.mean(bg[a:b][act] ** 2)) + 1e-9
        rep["lines"].append({"t0": ln_["t0"], "text": ln_["text"], "voice_over_bg_db": round(float(20 * np.log10(rv / rb)), 1)})
    json.dump(rep, open("build/mix_report.json", "w"), indent=1)
    print(json.dumps({k: rep[k] for k in ("final_peak_dbfs", "len_s", "clipped")}))
    worst = sorted(rep["lines"], key=lambda l: l["voice_over_bg_db"])[:5]
    print("lowest voice/bg lines:", [(l["text"], l["voice_over_bg_db"]) for l in worst])


if __name__ == "__main__":
    main()
