"""Narration with the free Edge neural TTS (edge-tts). One mp3 + word timings per line -> build/voice/."""
import asyncio, json, os, ssl, sys
import edge_tts, edge_tts.communicate as ec
from script import LINES

CA = "/root/.ccr/ca-bundle.crt"            # sandbox TLS proxy; harmless elsewhere
if os.path.exists(CA):
    ec._SSL_CTX = ssl.create_default_context(cafile=CA)
PROXY = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
VOICE = os.environ.get("HORROR_VOICE", "en-US-ChristopherNeural")

async def one(i, text, rate, pitch, out):
    c = edge_tts.Communicate(text, VOICE, rate=rate, pitch=pitch, boundary="WordBoundary", proxy=PROXY)
    words, audio = [], bytearray()
    async for ch in c.stream():
        if ch["type"] == "audio": audio += ch["data"]
        elif ch["type"] == "WordBoundary":
            words.append({"word": ch["text"], "start": ch["offset"] / 1e7, "dur": ch["duration"] / 1e7})
    open(f"{out}/line{i:02d}.mp3", "wb").write(audio)
    json.dump({"text": text, "voice": VOICE, "rate": rate, "pitch": pitch, "words": words}, open(f"{out}/line{i:02d}.json", "w"), indent=1)

async def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "build/voice"
    os.makedirs(out, exist_ok=True)
    for i, (text, _, rate, pitch, _) in enumerate(LINES):
        await one(i, text, rate, pitch, out)
    print("voice lines:", len(LINES))

asyncio.run(main())
