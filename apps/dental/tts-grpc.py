# tts-grpc.py — NVCF TTS via the gRPC Riva client (the HTTP route is intermittently unhealthy;
# gRPC with the same function-id serves reliably). Prints a complete WAV file to stdout.
# Usage: python tts-grpc.py "text" "Magpie-Multilingual.EN-US.Sofia"
# Reads the API key from nvcf.key next to this file. Exits 1 with a message on stderr on failure.
import io
import sys

import riva.client

SAMPLE_RATE = 22050
FUNCTION_ID = "877104f7-e885-42b9-8de8-f6e4c6303969"
SERVER = "grpc.nvcf.nvidia.com:443"


def wav_header(pcm: bytes, rate: int = SAMPLE_RATE, channels: int = 1, bits: int = 16) -> bytes:
    # 44-byte canonical PCM WAV header; server returns raw signed 16-bit little-endian mono
    data_len = len(pcm)
    hdr = io.BytesIO()
    hdr.write(b"RIFF")
    hdr.write((36 + data_len).to_bytes(4, "little"))
    hdr.write(b"WAVEfmt ")
    hdr.write((16).to_bytes(4, "little"))
    hdr.write((1).to_bytes(2, "little"))           # PCM
    hdr.write(channels.to_bytes(2, "little"))
    hdr.write(rate.to_bytes(4, "little"))
    hdr.write((rate * channels * bits // 8).to_bytes(4, "little"))
    hdr.write((channels * bits // 8).to_bytes(2, "little"))
    hdr.write(bits.to_bytes(2, "little"))
    hdr.write(b"data")
    hdr.write(data_len.to_bytes(4, "little"))
    return hdr.getvalue() + pcm


def main() -> int:
    if len(sys.argv) < 2 or not sys.argv[1].strip():
        print("usage: tts-grpc.py TEXT [VOICE]", file=sys.stderr)
        return 1
    text = sys.argv[1].strip()[:2000]
    voice = (sys.argv[2].strip() if len(sys.argv) > 2 else "Magpie-Multilingual.EN-US.Sofia")

    try:
        with open("nvcf.key", "r", encoding="utf-8") as f:
            key = f.read().strip()
    except OSError:
        print("nvcf.key not found", file=sys.stderr)
        return 1
    if not key:
        print("nvcf.key is empty", file=sys.stderr)
        return 1

    lang = "en-US"
    for part in voice.split("."):
        if "-" in part and len(part) == 5:
            lang = part.lower()
            break

    try:
        auth = riva.client.Auth(
            uri=SERVER,
            use_ssl=True,
            metadata_args=[["function-id", FUNCTION_ID], ["authorization", f"Bearer {key}"]],
        )
        tts = riva.client.SpeechSynthesisService(auth)
        resp = tts.synthesize(text=text, voice_name=voice, language_code=lang,
                              sample_rate_hz=SAMPLE_RATE)
        pcm = resp.audio
    except Exception as exc:  # upstream / auth / network errors
        print(f"tts-grpc: {type(exc).__name__}: {str(exc)[:200]}", file=sys.stderr)
        return 1

    if not pcm or len(pcm) < 32:
        print("tts-grpc: empty audio from upstream", file=sys.stderr)
        return 1

    sys.stdout.buffer.write(wav_header(bytes(pcm)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
