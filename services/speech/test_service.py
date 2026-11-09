import unittest
from fastapi.testclient import TestClient
from service import create_app, MAX_BYTES

TOKEN = "a-test-token-with-at-least-24-characters"


class FakeEngine:
    ready = True
    restart_task = None
    calls = 0

    async def start(self):
        pass

    def stop(self):
        pass

    async def transcribe(self, audio, language, request):
        self.calls += 1
        return {"text": "继续执行", "audio_seconds": 2, "recognition_ms": 100}


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.engine = FakeEngine()
        self.client = TestClient(create_app(self.engine, TOKEN))
        self.auth = {"Authorization": "Bearer " + TOKEN}

    def test_auth_rejects_before_inference(self):
        for path in ["/healthz", "/v1/audio/transcriptions"]:
            response = self.client.request("GET" if path == "/healthz" else "POST", path, content=b"audio")
            self.assertEqual(response.status_code, 401)
        self.assertEqual(self.engine.calls, 0)

    def test_contract_and_bounds(self):
        response = self.client.post("/v1/audio/transcriptions", headers=self.auth, content=b"audio")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["text"], "继续执行")
        self.assertTrue(response.json()["request_id"])
        self.assertEqual(self.client.post("/v1/audio/transcriptions", headers=self.auth, content=b"").status_code, 400)
        self.assertEqual(self.client.post("/v1/audio/transcriptions", headers=self.auth, content=b"x" * (MAX_BYTES + 1)).status_code, 413)
        self.assertEqual(self.client.post("/v1/audio/transcriptions?language=unknown", headers=self.auth, content=b"audio").status_code, 400)
        self.assertEqual(self.engine.calls, 1)

    def test_model_recovery_refuses_new_audio(self):
        self.engine.ready = False
        self.assertEqual(self.client.get("/healthz", headers=self.auth).status_code, 503)
        self.assertEqual(self.client.post("/v1/audio/transcriptions", headers=self.auth, content=b"audio").status_code, 503)
        self.assertEqual(self.engine.calls, 0)

    def test_timeout_becomes_retryable_gateway_error(self):
        async def timeout(*args):
            raise TimeoutError()
        self.engine.transcribe = timeout
        response = self.client.post("/v1/audio/transcriptions", headers=self.auth, content=b"audio")
        self.assertEqual(response.status_code, 504)


if __name__ == "__main__":
    unittest.main()
