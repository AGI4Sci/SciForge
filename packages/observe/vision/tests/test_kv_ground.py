import json
import unittest
from pathlib import Path
import sys
from unittest.mock import Mock, patch


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

from sciforge_vision_sense.kv_ground import (
    DEFAULT_REMOTE_PATH_PREFIXES,
    ImageRef,
    ImageRefKind,
    KV_GROUND_REMOTE_PATH_PREFIXES_ENV,
    KV_GROUND_URL_ENV,
    KvGroundConfig,
    KvGroundClient,
    KvGroundError,
    classify_image_ref,
    remote_path_prefixes_from_env,
)


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload
        self.closed = False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")

    def close(self):
        self.closed = True


class KvGroundClientTests(unittest.TestCase):
    def test_health_calls_endpoint_and_parses_fields(self):
        with patch("sciforge_vision_sense.kv_ground.request.urlopen", return_value=FakeResponse({
            "ok": True,
            "model_dir": "/models/kv-ground",
            "cuda_available": True,
            "gpu_count": 2,
        })) as urlopen:
            result = KvGroundClient("http://kv.test").health()

        req = urlopen.call_args.args[0]
        self.assertEqual(req.full_url, "http://kv.test/health")
        self.assertEqual(req.get_method(), "GET")
        self.assertTrue(result.ok)
        self.assertEqual(result.model_dir, "/models/kv-ground")
        self.assertTrue(result.cuda_available)
        self.assertEqual(result.gpu_count, 2)

    def test_health_reports_diagnostic_when_not_ok(self):
        with patch("sciforge_vision_sense.kv_ground.request.urlopen", return_value=FakeResponse({
            "ok": False,
            "model_dir": None,
            "cuda_available": False,
            "gpu_count": 0,
        })):
            result = KvGroundClient("http://kv.test").health()

        self.assertFalse(result.ok)
        self.assertIn("ok=false", result.error)

    def test_predict_posts_payload_and_parses_point_response(self):
        response = {
            "coordinates": [120, 80],
            "text": "submit",
            "raw_text": "click submit",
            "image_size": [640, 480],
        }
        with patch("sciforge_vision_sense.kv_ground.request.urlopen", return_value=FakeResponse(response)) as urlopen:
            result = KvGroundClient("http://kv.test").predict(
                ImageRef.http_url("https://example.test/screen.png"),
                "submit button",
            )

        req = urlopen.call_args.args[0]
        self.assertEqual(req.full_url, "http://kv.test/predict/")
        self.assertEqual(req.get_method(), "POST")
        self.assertEqual(json.loads(req.data.decode("utf-8")), {
            "image_path": "https://example.test/screen.png",
            "text_prompt": "submit button",
        })
        self.assertEqual(result.coordinates, (120.0, 80.0))
        self.assertEqual(result.text, "submit")
        self.assertEqual(result.raw_text, "click submit")
        self.assertEqual(result.image_size, (640, 480))
        self.assertEqual(result.normalized_coordinates, (0.1875, 1 / 6))
        self.assertEqual(result.crop_bbox, (0, 0, 248, 208))

    def test_predict_parses_bbox_without_crop_window(self):
        with patch("sciforge_vision_sense.kv_ground.request.urlopen", return_value=FakeResponse({
            "coordinates": {"x1": 10, "y1": 20, "x2": 30, "y2": 40},
            "text": "target",
            "raw_text": "target",
            "image_size": {"width": 100, "height": 80},
        })):
            result = KvGroundClient("http://kv.test").predict(ImageRef.remote_path("/server/screen.png"), "target")

        self.assertEqual(result.coordinates, (10, 20, 30, 40))
        self.assertIsNone(result.crop_bbox)
        self.assertIsNone(result.normalized_coordinates)

    def test_image_ref_classification(self):
        self.assertEqual(classify_image_ref("https://example.test/a.png").kind, ImageRefKind.HTTP_URL)
        self.assertEqual(classify_image_ref("s3://bucket/a.png").kind, ImageRefKind.REMOTE_PATH)
        self.assertEqual(DEFAULT_REMOTE_PATH_PREFIXES, ())
        self.assertEqual(
            classify_image_ref(
                "/srv/kv-ground/tests/restart_check.png"
            ).kind,
            ImageRefKind.LOCAL_PATH,
        )
        self.assertEqual(
            classify_image_ref(
                "/srv/kv-ground/tests/restart_check.png",
                remote_path_prefixes=("/srv/kv-ground/",),
            ).kind,
            ImageRefKind.REMOTE_PATH,
        )
        self.assertEqual(
            classify_image_ref("/shared/a.png", remote_path_prefixes=("/shared/",)).kind,
            ImageRefKind.REMOTE_PATH,
        )
        self.assertEqual(classify_image_ref("/tmp/local.png").kind, ImageRefKind.LOCAL_PATH)

    def test_client_posts_configured_service_readable_prefix_as_remote_path(self):
        response = {
            "coordinates": [319.36, 180.0],
            "raw_text": "click(start_box='[499, 500]')",
            "image_size": {"width": 640, "height": 360},
        }
        with patch("sciforge_vision_sense.kv_ground.request.urlopen", return_value=FakeResponse(response)) as urlopen:
            result = KvGroundClient(
                "http://kv.test",
                remote_path_prefixes=("/srv/kv-ground/",),
            ).predict(
                "/srv/kv-ground/tests/restart_check.png",
                "Click the Submit button",
            )

        req = urlopen.call_args.args[0]
        payload = json.loads(req.data.decode("utf-8"))
        self.assertEqual(
            payload["image_path"],
            "/srv/kv-ground/tests/restart_check.png",
        )
        self.assertEqual(payload["text_prompt"], "Click the Submit button")
        self.assertEqual(result.coordinates, (319.36, 180.0))

    def test_client_accepts_mapping_config_for_url_and_remote_prefixes(self):
        response = {
            "coordinates": [2, 4],
            "raw_text": "ok",
            "image_size": [10, 20],
        }
        config = {
            "baseUrl": "http://kv-config.test",
            "remotePathPrefixes": ["/shared-kv/"],
            "timeoutSeconds": 5,
        }
        with patch("sciforge_vision_sense.kv_ground.request.urlopen", return_value=FakeResponse(response)) as urlopen:
            result = KvGroundClient(config=config).predict("/shared-kv/screen.png", "target")

        req = urlopen.call_args.args[0]
        self.assertEqual(req.full_url, "http://kv-config.test/predict/")
        self.assertEqual(json.loads(req.data.decode("utf-8"))["image_path"], "/shared-kv/screen.png")
        self.assertEqual(result.coordinates, (2.0, 4.0))

    def test_client_accepts_dataclass_config(self):
        response = {
            "coordinates": [2, 4],
            "raw_text": "ok",
            "image_size": [10, 20],
        }
        config = KvGroundConfig(base_url="http://kv-dataclass.test", remote_path_prefixes=("/shared-kv/",))
        with patch("sciforge_vision_sense.kv_ground.request.urlopen", return_value=FakeResponse(response)) as urlopen:
            KvGroundClient(config=config).predict("/shared-kv/screen.png", "target")

        self.assertEqual(urlopen.call_args.args[0].full_url, "http://kv-dataclass.test/predict/")

    def test_client_can_read_url_and_prefixes_from_env(self):
        response = {
            "coordinates": [1, 1],
            "raw_text": "ok",
            "image_size": [10, 10],
        }
        env = {
            KV_GROUND_URL_ENV: "http://kv-env.test",
            KV_GROUND_REMOTE_PATH_PREFIXES_ENV: "/mnt/kv/, /shared/",
        }
        self.assertEqual(remote_path_prefixes_from_env(env), ("/mnt/kv/", "/shared/"))
        with patch.dict("sciforge_vision_sense.kv_ground.os.environ", env, clear=True):
            with patch("sciforge_vision_sense.kv_ground.request.urlopen", return_value=FakeResponse(response)) as urlopen:
                KvGroundClient().predict("/mnt/kv/screen.png", "target")

        self.assertEqual(urlopen.call_args.args[0].full_url, "http://kv-env.test/predict/")

    def test_local_path_requires_uploader_or_service_readable_path(self):
        with self.assertRaisesRegex(KvGroundError, "local_path image refs require"):
            KvGroundClient("http://kv.test").predict(ImageRef.local_path("/tmp/screen.png"), "target")

    def test_client_requires_base_url_or_env(self):
        with patch.dict("sciforge_vision_sense.kv_ground.os.environ", {}, clear=True):
            with self.assertRaisesRegex(KvGroundError, "base_url is required"):
                KvGroundClient()

    def test_local_path_uses_uploader_when_provided(self):
        uploader = Mock(return_value="https://upload.test/screen.png")
        with patch("sciforge_vision_sense.kv_ground.request.urlopen", return_value=FakeResponse({
            "coordinates": [1, 2],
            "raw_text": "ok",
            "image_size": [10, 10],
        })) as urlopen:
            KvGroundClient("http://kv.test", remote_image_uploader=uploader).predict(
                ImageRef.local_path("/tmp/screen.png"),
                "target",
            )

        uploader.assert_called_once_with("/tmp/screen.png")
        req = urlopen.call_args.args[0]
        self.assertEqual(json.loads(req.data.decode("utf-8"))["image_path"], "https://upload.test/screen.png")


if __name__ == "__main__":
    unittest.main()
