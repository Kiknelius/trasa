"""Mix the soundtrack for Little Duck (22.8 s, 48 kHz stereo).

music  : Funkorama (Kevin MacLeod, CC-BY 4.0), beat-matched so each 2.4 s lyric slot is one bar
         and the bar starts land on 1.2 s, 3.6 s, ...; fade out over the last 0.7 s
voice  : build/voice_track.wav from fit_voice.py
sfx    : CC0 splashes / bubbles / rain (OpenGameArt), CC-BY quack (Mike Koenig, SoundBible),
         plus a code-synthesized whoosh (big spin jump) and star twinkles (night)
ducking: music is side-chained to the voice so the singing always sits on top

Outputs build/mix.wav (final), build/stems/*.wav and build/mix_report.json.
"""
import json, os, subprocess, tempfile, io
import numpy as np, soundfile as sf
import librosa
from scipy.signal import butter, sosfiltfilt

SR = 48000
DUR = 22.8
N = int(DUR * SR)
A = "assets"


def load(path, sr=SR):
    out = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(sr), "-f", "wav", "-"],
                         capture_output=True, check=True).stdout
    x, _ = sf.read(io.BytesIO(out), dtype="float64")
    return x


def place(buf, x, t, gain_db=0.0, pan=0.0):
    """add mono x into stereo buf at time t with constant-power pan (-1..1)"""
    g = 10 ** (gain_db / 20)
    i = int(round(t * SR))
    if i >= len(buf):
        return
    x = x[: len(buf) - i]
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    buf[i:i + len(x), 0] += x * g * l * np.sqrt(2)
    buf[i:i + len(x), 1] += x * g * r * np.sqrt(2)


def norm_peak(x, peak=0.9):
    return x * (peak / (np.abs(x).max() + 1e-9))


def resample_pitch(x, semis):
    """cheap pitch shift by resampling (also changes length, fine for short SFX)"""
    if semis == 0:
        return x
    f = 2 ** (semis / 12)
    idx = np.arange(0, len(x) - 1, f)
    return np.interp(idx, np.arange(len(x)), x)


def env_follow(x, attack=0.015, release=0.22):
    e = np.abs(x)
    out = np.zeros_like(e)
    a, r = np.exp(-1 / (attack * SR)), np.exp(-1 / (release * SR))
    v = 0.0
    for i in range(len(e)):  # simple peak follower
        c = a if e[i] > v else r
        v = c * v + (1 - c) * e[i]
        out[i] = v
    return out


def smoothstep(e0, e1, t):
    u = np.clip((t - e0) / (e1 - e0), 0, 1)
    return u * u * (3 - 2 * u)


# ------------------------------------------------------------------ music (beat-matched)
def make_music():
    # MUSIC_FILE / MUSIC_DOWNBEAT let you swap in another track (e.g. one downloaded from Pixabay):
    # MUSIC_DOWNBEAT is the time (s) in that file of a bar start that should land on the first lyric (1.2 s).
    src = os.environ.get("MUSIC_FILE", f"{A}/music/Funkorama.mp3")
    db_guess = float(os.environ.get("MUSIC_DOWNBEAT", "28.56"))
    off = max(0.0, db_guess - 8.0)
    y, sr = librosa.load(src, sr=22050, mono=True, offset=off, duration=45)
    oenv = librosa.onset.onset_strength(y=y, sr=sr)
    _, beats = librosa.beat.beat_track(onset_envelope=oenv, sr=sr, start_bpm=100, tightness=400)
    bt = librosa.frames_to_time(beats, sr=sr) + off
    k = np.arange(len(bt))
    P, b0 = np.polyfit(k, bt, 1)                       # source beat period (s)
    # downbeat ~28.56 s (strong kick phase found in analysis): snap to the fitted grid
    D = b0 + P * np.round((db_guess - b0) / P)
    f = P / 0.6                                        # atempo factor -> 100 BPM exactly
    S = D - 1.2 * f                                    # source time that lands at output 0
    with tempfile.TemporaryDirectory() as d:
        o = f"{d}/m.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{S:.4f}", "-t", f"{DUR * f + 1:.3f}", "-i", src,
                        "-af", f"atempo={f:.6f}", "-ar", str(SR), "-ac", "2", o], check=True)
        m, _ = sf.read(o, dtype="float64")
    m = m[:N]
    if len(m) < N:
        m = np.pad(m, ((0, N - len(m)), (0, 0)))
    return m, {"source_beat_period": P, "bpm_src": 60 / P, "atempo": f, "source_start": S, "downbeat_src": D}


def lowpass(x, fc):
    sos = butter(4, fc, btype="low", fs=SR, output="sos")
    return sosfiltfilt(sos, x, axis=0)


# ------------------------------------------------------------------ synthesized sound design
def whoosh(dur=0.7, seed=1):
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    noise = rng.standard_normal(n)
    t = np.arange(n) / SR
    out = np.zeros(n)
    # sweep a band-pass up and back down by blending a few fixed bands
    for fc in (400, 800, 1600, 3200):
        sos = butter(2, [fc * 0.7, fc * 1.4], btype="band", fs=SR, output="sos")
        band = sosfiltfilt(sos, noise)
        centre = np.log2(fc / 400) / 3.0                   # 0..1
        pos = np.sin(np.pi * t / dur)                       # 0 -> 1 -> 0
        w = np.exp(-((pos - centre) ** 2) / 0.08)
        out += band * w
    env = np.sin(np.pi * t / dur) ** 1.5
    return norm_peak(out * env, 0.5)


def twinkle(freq, dur=0.9):
    t = np.arange(int(dur * SR)) / SR
    x = (np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * freq * 2.76 * t) * np.exp(-t * 9)
         + 0.2 * np.sin(2 * np.pi * freq * 5.4 * t) * np.exp(-t * 14))
    x *= np.exp(-t * 4.5) * np.minimum(1, t / 0.004)
    return norm_peak(x, 0.5)


def main():
    os.makedirs("build/stems", exist_ok=True)
    words = json.load(open("build/words.json"))
    wt = lambda line, i: next(w["t0"] for w in words if w["line"] == line and w["i"] == i)
    tt = np.arange(N) / SR

    # ---------------- voice
    v = load("build/voice_track.wav")[:N]
    v = np.pad(v, (0, N - len(v)))
    # +2 dB on the lines that carry splash / rain effects so the singing stays on top
    vg = 1 + (10 ** (2 / 20) - 1) * (smoothstep(1.1, 1.2, tt) * (1 - smoothstep(3.55, 3.6, tt)) + smoothstep(10.7, 10.8, tt) * (1 - smoothstep(15.45, 15.55, tt)))
    v = v * vg
    voice = np.stack([v, v], 1)

    # ---------------- music: beat matched, sleepy low-pass at night, fade out
    music, minfo = make_music()
    night = smoothstep(15.3, 16.6, tt)[:, None]
    music = music * (1 - night) + lowpass(music, 1400) * night * 1.15
    music *= (10 ** (-2.5 / 20 * night))
    fade = np.where(tt >= DUR - 0.7, np.cos((tt - (DUR - 0.7)) / 0.7 * np.pi / 2) ** 2, 1.0)
    music *= fade[:, None]
    music *= np.minimum(1, tt / 0.01)[:, None]             # 10 ms fade-in (no click at the first frame)
    # side-chain ducking from the voice (-8 dB at full voice, smooth attack/release)
    ve = env_follow(v, 0.02, 0.25)
    ve = np.clip(ve / (np.percentile(ve[ve > 1e-4], 90) + 1e-9), 0, 1)
    duck_db = -8.0 * ve
    music *= (10 ** (duck_db / 20))[:, None]

    # ---------------- sfx
    sfx = np.zeros((N, 2))
    S = {k: load(f"{A}/sfx/{k}") for k in ["splash_01.ogg", "splash_02.ogg", "splash_03.ogg", "splash_04.ogg",
                                          "splash_06.ogg", "splash_08.ogg", "splash_09.ogg", "bubble_01.ogg",
                                          "bubble_02.ogg", "bubble_03.ogg", "loop_rain.ogg", "water_drop.wav"]}
    S = {k: norm_peak(x, 0.9) for k, x in S.items()}
    quack_src = load(f"{A}/sfx/quack_mallard_MikeKoenig.mp3")
    q = quack_src[int(0.29 * SR):int(0.76 * SR)].copy()          # a clean "quack-quack"
    q *= np.minimum(1, np.minimum(np.arange(len(q)) / 240, (len(q) - np.arange(len(q))) / 2400))
    sos = butter(2, 250, btype="high", fs=SR, output="sos"); q = sosfiltfilt(sos, q)
    quack = norm_peak(resample_pitch(q, 3), 0.9)                  # a little higher: a young duck

    # title quack (no voice there) + soft quack under the closing "Goodnight"
    place(sfx, quack, 0.32, -6, pan=-0.1)

    # splashes on the hop landings (times shared with the animation via words.json)
    splash_t = [wt(0, 4), wt(0, 5), wt(0, 6), wt(1, 2)]
    for i, t in enumerate(splash_t):
        place(sfx, S[["splash_02.ogg", "splash_06.ogg", "splash_08.ogg", "splash_03.ogg"][i]], t - 0.01, -15, pan=(-0.2, 0.0, 0.1, 0.0)[i])
    place(sfx, S["splash_04.ogg"], wt(1, 6) - 0.015, -6)                        # BIG splash on "dash"
    place(sfx, S["splash_01.ogg"], wt(1, 6) + 0.05, -13, pan=0.25)
    place(sfx, whoosh(0.62), wt(1, 6) - 0.68, -12)                              # spin jump
    # little footsteps while waddling through the puddle (x inside puddle: ~9.0-10.7 s)
    for k, t in enumerate(np.arange(9.0, 10.75, 0.3)):
        place(sfx, resample_pitch(S["splash_09.ogg"], 4 + (k % 3)), t, -25, pan=(-0.15 if k % 2 else 0.15))
    # rain: ambience bed + big plops on the duck's head + 5 hop splashes
    rain = np.tile(S["loop_rain.ogg"], 2)
    r0, r1 = 10.6, 16.1
    seg = rain[: int((r1 - r0) * SR)]
    tseg = np.arange(len(seg)) / SR + r0
    seg = seg * smoothstep(10.6, 11.4, tseg) * (1 - smoothstep(15.3, 16.1, tseg))
    place(sfx, seg, r0, -19)
    for i, t in enumerate([wt(4, 2), wt(4, 3), wt(4, 4)]):
        place(sfx, resample_pitch(S["bubble_02.ogg"], (-2, 0, 2)[i]), t - 0.01, -13)
        place(sfx, S["water_drop.wav"], t - 0.02, -17)
    for i in range(5):
        t = wt(5, i)
        place(sfx, resample_pitch(S["splash_06.ogg"], (0, 2, 1, 3, 2)[i]), t - 0.01, -23, pan=(-0.15 if i % 2 else 0.15))
    # night: twinkles as the stars come out (D minor pentatonic, high octave)
    notes = [1174.66, 1396.91, 1760.0, 2093.0, 2349.32, 1760.0, 2793.83]
    for i, t in enumerate(np.linspace(16.05, 17.25, len(notes))):
        place(sfx, twinkle(notes[i]), t, -22, pan=np.sin(i * 1.7) * 0.5)
    # a sleepy, slowed-down mini quack after "Goodnight, Little Duck!"
    sq = resample_pitch(quack[: int(0.2 * SR)], -3)
    place(sfx, sq * np.hanning(len(sq)), 22.15, -24)

    # ---------------- sum, loudness normalise (-14 LUFS, TP -1.5 dB)
    stems = {"music": music, "voice": voice * 10 ** (0 / 20), "sfx": sfx}
    for k, x in stems.items():
        sf.write(f"build/stems/{k}.wav", x.astype(np.float32), SR, subtype="FLOAT")
    # level balance before normalisation: voice lead, music bed ~-10 dB under the voice
    mix = stems["voice"] * 1.0 + stems["music"] * 0.33 + stems["sfx"] * 0.5
    sf.write("build/mix_pre.wav", mix.astype(np.float32), SR, subtype="FLOAT")
    ln = subprocess.run(["ffmpeg", "-hide_banner", "-i", "build/mix_pre.wav", "-af",
                         "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
                        capture_output=True, text=True).stderr
    meas = json.loads(ln[ln.rindex("{"):ln.rindex("}") + 1])
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", "build/mix_pre.wav", "-af",
                    f"loudnorm=I=-14:TP=-1.5:LRA=11:measured_I={meas['input_i']}:measured_TP={meas['input_tp']}"
                    f":measured_LRA={meas['input_lra']}:measured_thresh={meas['input_thresh']}"
                    f":offset={meas['target_offset']}:linear=true,aresample=48000",
                    "-ar", str(SR), "-c:a", "pcm_s24le", "build/mix.wav"], check=True)
    final, _ = sf.read("build/mix.wav", dtype="float64")
    final = final[:N]

    # ---------------- report: voice-to-background ratio per lyric line, peaks
    rep = {"music": minfo, "loudnorm_in": meas, "final_peak_dbfs": float(20 * np.log10(np.abs(final).max())),
           "final_len_s": len(final) / SR, "clipped_samples": int(np.sum(np.abs(final) >= 0.999)), "lines": []}
    bg = stems["music"] * 0.33 + stems["sfx"] * 0.5
    for line in range(9):
        ws = [w for w in words if w["line"] == line]
        a, b = int(ws[0]["t0"] * SR), int(ws[-1]["t1"] * SR)
        vv = stems["voice"][a:b]
        act = np.abs(vv[:, 0]) > 0.01
        rv = np.sqrt(np.mean(vv[act] ** 2)); rb = np.sqrt(np.mean(bg[a:b][act] ** 2))
        rep["lines"].append({"line": line, "t": [ws[0]["t0"], ws[-1]["t1"]], "voice_over_bg_db": round(float(20 * np.log10(rv / rb)), 1)})
    json.dump(rep, open("build/mix_report.json", "w"), indent=1)
    print(json.dumps({k: rep[k] for k in ("final_peak_dbfs", "final_len_s", "clipped_samples")}))
    print("music:", {k: round(v, 4) for k, v in minfo.items()})
    for l in rep["lines"]:
        print(l)


if __name__ == "__main__":
    main()
