"""Evidence delta v1 JSON: sorted UTF-16 keys and ECMAScript binary64 numbers.

This mirrors evidence-delta.ts canonicalJson without changing existing TS hashes.
It is deliberately not Python's json.dumps numeric / code-point-sort convention.
Existing TS-produced v1 envelopes keep their identities, including those the old
Python validator rejected. Python-only re-signed variants are not a second valid
v1 identity: no digest fallback, re-keying or immutable-history migration is used.
"""
from __future__ import annotations

import json
import math
from typing import Any


def _number(value: int | float) -> str:
    """Shortest round-tripping decimal, nearest then ties-to-even (ECMA-262)."""
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("Evidence delta numbers must be finite binary64")
    if number == 0:
        return "0"
    sign = "-" if number < 0 else ""
    number = abs(number)
    numerator, denominator = number.as_integer_ratio()
    exponent = len(str(numerator)) - len(str(denominator))
    if (numerator < denominator * 10 ** exponent if exponent >= 0
            else numerator * 10 ** -exponent < denominator):
        exponent -= 1
    # Every binary64 has a round-tripping decimal with at most 17 digits.
    # Use exact rational rounding, not repr formatting or exponent substitutions.
    digits = scale = 0
    for precision in range(1, 18):
        scale = precision - 1 - exponent
        top, bottom = (numerator * 10 ** scale, denominator) if scale >= 0 else (
            numerator, denominator * 10 ** -scale
        )
        digits, remainder = divmod(top, bottom)
        if 2 * remainder > bottom or (2 * remainder == bottom and digits % 2):
            digits += 1
        if float(f"{digits}e{-scale}") == number:
            break
    while digits % 10 == 0:
        digits //= 10
        scale -= 1
    text = str(digits)
    point = len(text) - scale
    exponent = point - 1
    if -6 <= exponent < 21:
        if point <= 0:
            text = "0." + "0" * -point + text
        elif point >= len(text):
            text += "0" * (point - len(text))
        else:
            text = text[:point] + "." + text[point:]
    else:
        text = text[0] + ("." + text[1:] if len(text) > 1 else "")
        text += "e" + ("+" if exponent >= 0 else "-") + str(abs(exponent))
    return sign + text


def _string(value: str) -> str:
    # JS strings are UTF-16: combine pairs, but escape lone surrogates as does
    # well-formed JSON.stringify, so hashing UTF-8 never fails on a legal string.
    value = value.encode("utf-16-le", "surrogatepass").decode("utf-16-le", "surrogatepass")
    quoted = json.dumps(value, ensure_ascii=False)
    return "".join(f"\\u{ord(char):04x}" if 0xD800 <= ord(char) <= 0xDFFF else char for char in quoted)


def canonical_delta_json(value: Any) -> str:
    """Encode the existing TS delta value-tree contract, never a fallback hash."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return _number(value)
    if isinstance(value, str):
        return _string(value)
    if isinstance(value, list):
        return "[" + ",".join(canonical_delta_json(child) for child in value) + "]"
    if isinstance(value, dict) and all(isinstance(key, str) for key in value):
        keys = sorted(value, key=lambda key: key.encode("utf-16-be", "surrogatepass"))
        return "{" + ",".join(_string(key) + ":" + canonical_delta_json(value[key]) for key in keys) + "}"
    raise TypeError("Evidence delta requires JSON values")
