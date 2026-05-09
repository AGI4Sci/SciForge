from pathlib import Path
import sys


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

from sciforge_vision_sense.executor import ExecutionResult, GuiExecutor, Point


class FakeExecutor:
    def __init__(self):
        self.calls = []

    def click(self, point: Point):
        self.calls.append(("click", point))
        return ExecutionResult()

    def type_text(self, text: str):
        self.calls.append(("type_text", text))
        return ExecutionResult(message="clipboard paste")

    def press_key(self, key: str):
        self.calls.append(("press_key", key))
        return ExecutionResult()

    def scroll(self, direction: str, amount: float):
        self.calls.append(("scroll", direction, amount))
        return ExecutionResult()


def test_gui_executor_contract_has_expected_methods():
    executor: GuiExecutor = FakeExecutor()

    executor.click(Point(4, 8))
    result = executor.type_text("whole text")
    executor.press_key("Enter")
    executor.scroll("down", 3)

    assert result is not None
    assert result.message == "clipboard paste"
    assert executor.calls == [
        ("click", Point(4, 8)),
        ("type_text", "whole text"),
        ("press_key", "Enter"),
        ("scroll", "down", 3),
    ]


def test_executor_contract_documents_clipboard_paste_strategy():
    assert "clipboard" in (GuiExecutor.type_text.__doc__ or "").lower()
    assert "character" in (GuiExecutor.type_text.__doc__ or "").lower()
