"""Generate the sung/spoken lyric lines with edge-tts (free Microsoft Edge read-aloud voices).
Outputs one MP3 + word-timing JSON per line into build/voice/."""
import asyncio, json, os, ssl, sys
import edge_tts, edge_tts.communicate as ec

# The sandbox re-terminates TLS: point edge-tts at the proxy CA bundle when present.
CA = "/root/.ccr/ca-bundle.crt"
if os.path.exists(CA):
    ec._SSL_CTX = ssl.create_default_context(cafile=CA)
PROXY = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")

VOICE = os.environ.get("DUCK_VOICE", "en-US-AnaNeural")   # child-like, "Cute" style
LINES = [
    "Little Duck, Little Duck, splash, splash, splash!",
    "Jumping in puddles, make a big dash!",
    "Little Duck, Little Duck, quack, quack, quack!",
    "Waddle to the pond and then waddle back!",
    "Rain goes plop, plop, plop,",
    "Hop, hop, hop, hop, hop!",
    "Little Duck, Little Duck, time for bed,",
    "Sleepy little feathers on your sleepy little head.",
    "Goodnight, Little Duck!",
]
# per-line prosody (rate/pitch) - cheerful, a little higher; sleepy lines slower and softer
PROSODY = [("+20%", "+10Hz")] * 6 + [("+10%", "+6Hz"), ("+15%", "+4Hz"), ("-8%", "+0Hz")]

async def one(i, text, out):
    rate, pitch = PROSODY[i]
    c = edge_tts.Communicate(text, VOICE, rate=rate, pitch=pitch, boundary="WordBoundary", proxy=PROXY)
    words, audio = [], bytearray()
    async for ch in c.stream():
        if ch["type"] == "audio":
            audio += ch["data"]
        elif ch["type"] == "WordBoundary":
            words.append({"word": ch["text"], "start": ch["offset"] / 1e7, "dur": ch["duration"] / 1e7})
    open(f"{out}/line{i}.mp3", "wb").write(audio)
    json.dump({"text": text, "voice": VOICE, "rate": rate, "pitch": pitch, "words": words},
              open(f"{out}/line{i}.json", "w"), indent=1)

async def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "build/voice"
    os.makedirs(out, exist_ok=True)
    for i, t in enumerate(LINES):
        await one(i, t, out)
        print("ok", i, t)

asyncio.run(main())
