"""Single-user, authenticated short-clip ASR for Steer. Run one uvicorn worker."""
import asyncio
from contextlib import asynccontextmanager
import hmac
import multiprocessing as mp
import os
from pathlib import Path
import subprocess
import tempfile
import time
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

MAX_BYTES = 2 * 1024 * 1024
MODEL = os.getenv("STEER_SPEECH_MODEL", "mlx-community/Qwen3-ASR-0.6B-8bit")
BACKEND = os.getenv("STEER_SPEECH_BACKEND", "mlx")


def infer_worker(pipe, model_id, temporary_root):
    # MLX initialization and every inference stay in this dedicated process.
    try:
        import numpy as np
        import soundfile as sf
        if BACKEND == "sherpa":
            import sherpa_onnx
            recognizers = {}
            def recognize(samples, language):
                lang = {"Chinese": "zh", "English": "en", None: "auto"}[language]
                if lang not in recognizers:
                    recognizers[lang] = sherpa_onnx.OfflineRecognizer.from_sense_voice(
                        model=str(Path(model_id) / "model.int8.onnx"),
                        tokens=str(Path(model_id) / "tokens.txt"), num_threads=2,
                        use_itn=True, language=lang, provider="cpu")
                recognizer = recognizers[lang]
                stream = recognizer.create_stream()
                stream.accept_waveform(16000, samples)
                recognizer.decode_stream(stream)
                return stream.result.text
        else:
            from mlx_audio.stt.utils import load_model
            model = load_model(model_id)
            def recognize(samples, language):
                return model.generate(samples, language=language, max_tokens=256).text
        # Warm without storing or logging any user audio.
        recognize(np.zeros(16000, dtype=np.float32), "Chinese")
        pipe.send({"ready": True})
        while True:
            audio, language = pipe.recv()
            try:
                with tempfile.TemporaryDirectory(prefix="clip-", dir=temporary_root) as directory:
                    source = Path(directory) / "input.audio"
                    target = Path(directory) / "decoded.wav"
                    source.write_bytes(audio)
                    decoded = subprocess.run([
                        os.getenv("STEER_FFMPEG", "/opt/homebrew/bin/ffmpeg"),
                        "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe",
                        "-format_whitelist", "mov,wav,mp3,flac,ogg,aac", "-i", str(source), "-t", "31",
                        "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(target),
                    ], capture_output=True, timeout=15)
                    if decoded.returncode:
                        raise ValueError("无法解码录音，请重新录音")
                    samples, rate = sf.read(target, dtype="float32")
                    duration = len(samples) / rate
                    if not 0.1 <= duration <= 30:
                        raise ValueError("录音应为 0.1–30 秒")
                    if float(np.sqrt(np.mean(samples ** 2))) < 0.0001:
                        raise ValueError("没有听到说话，请重新录音")
                    started = time.monotonic()
                    text = recognize(samples, language).strip()
                    if not text:
                        raise ValueError("没有听清，请重新录音")
                    pipe.send({"text": text, "audio_seconds": round(duration, 3),
                               "recognition_ms": round((time.monotonic() - started) * 1000)})
            except ValueError as error:
                pipe.send({"error": str(error), "status": 400})
            except Exception:
                pipe.send({"error": "语音识别失败，请重试", "status": 500})
    except BaseException:
        # No audio/transcript/provider credentials in service logs.
        try:
            pipe.send({"error": "语音模型启动失败，请检查服务日志与模型配置", "status": 503})
        except (BrokenPipeError, EOFError):
            pass
    finally:
        pipe.close()


class Engine:
    def __init__(self):
        self.process = None
        self.pipe = None
        self.ready = False
        self.restart_task = None
        self.directory = None

    async def start(self):
        self.stop()
        context = mp.get_context("spawn")
        # The parent owns cleanup even when native inference is force-stopped.
        self.directory = tempfile.TemporaryDirectory(prefix="steer-asr-worker-")
        self.pipe, child = context.Pipe()
        self.process = context.Process(target=infer_worker, args=(child, MODEL, self.directory.name), daemon=True)
        self.process.start()
        child.close()
        try:
            async with asyncio.timeout(600):
                while not self.pipe.poll():
                    if not self.process.is_alive():
                        raise RuntimeError("ASR worker exited during startup")
                    await asyncio.sleep(0.1)
                result = self.pipe.recv()
                if not result.get("ready"):
                    raise RuntimeError(result.get("error", "ASR startup failed"))
            self.ready = True
        except BaseException:
            self.stop()
            raise

    def stop(self):
        self.ready = False
        if self.process:
            if self.process.is_alive():
                self.process.terminate()
            self.process.join(timeout=2)
            if self.process.is_alive():
                self.process.kill()
                self.process.join(timeout=2)
            self.process.close()
            self.process = None
        if self.pipe:
            self.pipe.close()
            self.pipe = None
        if self.directory:
            self.directory.cleanup()
            self.directory = None

    def restart(self):
        # Cancel really stops native inference; a fresh worker warms in background.
        self.stop()
        async def recover():
            try:
                await self.start()
            except Exception:
                self.ready = False
        self.restart_task = asyncio.create_task(recover())

    async def transcribe(self, audio, language, request):
        try:
            self.pipe.send((audio, language))
            async with asyncio.timeout(45):
                while not self.pipe.poll():
                    if not self.process.is_alive():
                        raise RuntimeError("ASR worker exited")
                    if await request.is_disconnected():
                        raise HTTPException(499, "语音转写已取消")
                    await asyncio.sleep(0.05)
                return self.pipe.recv()
        except BaseException:
            self.restart()
            raise


def create_app(engine=None, token=None):
    engine = engine or Engine()
    if token is None:
        token = os.getenv("STEER_SPEECH_TOKEN", "")
        if not token and os.getenv("STEER_SPEECH_TOKEN_FILE"):
            token = Path(os.environ["STEER_SPEECH_TOKEN_FILE"]).read_text().strip()
    if len(token) < 24:
        raise RuntimeError("STEER_SPEECH_TOKEN must contain at least 24 characters")
    lock = asyncio.Lock()

    @asynccontextmanager
    async def lifespan(app):
        await engine.start()
        try:
            yield
        finally:
            if engine.restart_task:
                engine.restart_task.cancel()
                await asyncio.gather(engine.restart_task, return_exceptions=True)
            engine.stop()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    def authenticate(request):
        supplied = request.headers.get("authorization", "")
        if not hmac.compare_digest(supplied.encode(), ("Bearer " + token).encode()):
            raise HTTPException(401, "语音服务密钥无效")

    @app.exception_handler(HTTPException)
    async def http_error(request, error):
        return JSONResponse({"error": error.detail}, status_code=error.status_code)

    @app.get("/healthz")
    async def health(request: Request):
        authenticate(request)
        return JSONResponse({"ready": engine.ready, "model": MODEL, "backend": BACKEND, "busy": lock.locked()},
                            status_code=200 if engine.ready else 503)

    @app.post("/v1/audio/transcriptions")
    async def transcribe(request: Request, language: str = "zh"):
        authenticate(request)
        languages = {"zh": "Chinese", "zh-CN": "Chinese", "en": "English", "en-US": "English", "auto": None}
        if language not in languages:
            raise HTTPException(400, "当前支持 zh、en 或 auto")
        if not engine.ready or lock.locked():
            raise HTTPException(503, "语音服务正在准备或忙碌，请稍后重试")
        async with lock:
            audio = bytearray()
            try:
                async with asyncio.timeout(20):
                    async for chunk in request.stream():
                        audio.extend(chunk)
                        if len(audio) > MAX_BYTES:
                            raise HTTPException(413, "录音文件超过 2 MB")
                if not audio:
                    raise HTTPException(400, "录音为空")
                started = time.monotonic()
                result = await engine.transcribe(bytes(audio), languages[language], request)
            except TimeoutError:
                raise HTTPException(504, "语音识别超时，请重试")
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(503, "语音服务暂不可用，请重试")
            if "error" in result:
                raise HTTPException(result.get("status", 500), result["error"])
            return {**result, "request_id": str(uuid.uuid4()), "model": MODEL,
                    "elapsed_ms": round((time.monotonic() - started) * 1000)}

    return app
