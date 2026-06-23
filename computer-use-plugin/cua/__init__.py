"""SciForge Computer-Use plugin: a standalone, plug-and-play module that drives
GUI-Owl-1.5 end-to-end (one Qwen3-VL-based model is the whole agent — it reads
the screen AND decides each action; no Agent-S, no separate planner/grounder).
Optionally runs the official Mobile-Agent-v3 Reflector after each action to
verify the outcome and self-correct. Executes on the local Windows/Mac/Linux
desktop and returns a ServiceResult (evidence/trace), never a final answer.
"""
__version__ = "0.1.0"
