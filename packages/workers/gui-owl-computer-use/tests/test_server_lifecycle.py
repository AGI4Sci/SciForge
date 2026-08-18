from __future__ import annotations

import signal
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from cua.server import serve
from cua.service import ComputerUseService


class _NoopHandler(BaseHTTPRequestHandler):
    def log_message(self, *_args: Any) -> None:
        pass


def _shutdown_server(server: ThreadingHTTPServer) -> None:
    server.shutdown()


def test_serve_finally_shuts_down_service_and_closes_server() -> None:
    service = ComputerUseService()
    server = ThreadingHTTPServer(("127.0.0.1", 0), _NoopHandler)
    stopper = threading.Thread(target=_shutdown_server, args=(server,))
    stopper.start()

    result = serve(server, service=service)

    stopper.join(timeout=3)
    assert result["ok"] is True
    assert service.status()["lifecycleState"] == "stopped"
    assert server.socket.fileno() == -1


def test_signal_handler_requests_shutdown_from_helper_thread(monkeypatch) -> None:
    service = ComputerUseService()
    server = ThreadingHTTPServer(("127.0.0.1", 0), _NoopHandler)
    installed: dict[signal.Signals, Any] = {}

    def install(candidate: signal.Signals, handler: Any) -> Any:
        previous = installed.get(candidate, signal.SIG_DFL)
        installed[candidate] = handler
        return previous

    monkeypatch.setattr(signal, "getsignal", lambda candidate: installed.get(candidate, signal.SIG_DFL))
    monkeypatch.setattr(signal, "signal", install)

    def send_term() -> None:
        while signal.SIGTERM not in installed:
            threading.Event().wait(0.01)
        installed[signal.SIGTERM](signal.SIGTERM, None)

    sender = threading.Thread(target=send_term)
    sender.start()
    result = serve(server, service=service)
    sender.join(timeout=3)

    assert result["ok"] is True
    assert service.status()["lifecycleState"] == "stopped"
    assert installed[signal.SIGINT] == signal.SIG_DFL
    assert installed[signal.SIGTERM] == signal.SIG_DFL


def test_service_shutdown_is_idempotent() -> None:
    service = ComputerUseService()

    first = service.shutdown()
    second = service.shutdown()

    assert first["ok"] is True
    assert second == first
