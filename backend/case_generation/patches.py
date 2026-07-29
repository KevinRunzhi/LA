from __future__ import annotations

import copy
from typing import Any

try:
    from ..case_platform.errors import PlatformError
except ImportError:
    from case_platform.errors import PlatformError


def build_patch(current: Any, candidate: Any, pointer: str = "") -> list[dict[str, Any]]:
    """Build deterministic RFC 6902 add/remove/replace operations."""
    if type(current) is not type(candidate):
        return [{"op": "replace", "path": pointer, "value": copy.deepcopy(candidate)}]
    if isinstance(current, dict):
        operations = []
        for key in sorted(current.keys() - candidate.keys(), reverse=True):
            operations.append({"op": "remove", "path": _join(pointer, key)})
        for key in sorted(candidate.keys() - current.keys()):
            operations.append({"op": "add", "path": _join(pointer, key), "value": copy.deepcopy(candidate[key])})
        for key in sorted(current.keys() & candidate.keys()):
            operations.extend(build_patch(current[key], candidate[key], _join(pointer, key)))
        return operations
    if isinstance(current, list):
        if current == candidate:
            return []
        # Replacing one list avoids unstable indices while retaining field-level object diffs.
        return [{"op": "replace", "path": pointer, "value": copy.deepcopy(candidate)}]
    if current != candidate:
        return [{"op": "replace", "path": pointer, "value": copy.deepcopy(candidate)}]
    return []


def apply_patch(document: Any, operations: list[dict[str, Any]]) -> Any:
    result = copy.deepcopy(document)
    for operation in operations:
        op = operation.get("op")
        pointer = operation.get("path")
        if op not in {"add", "remove", "replace"} or not isinstance(pointer, str):
            raise PlatformError("generation_patch_invalid", "Patch 操作不符合 RFC 6902 子集", 422)
        if pointer == "":
            if op == "remove":
                raise PlatformError("generation_patch_invalid", "不能删除模块根对象", 422)
            result = copy.deepcopy(operation.get("value"))
            continue
        parent, token = _resolve_parent(result, pointer)
        if isinstance(parent, dict):
            if op in {"remove", "replace"} and token not in parent:
                raise PlatformError("generation_patch_invalid", "Patch 路径不存在", 422)
            if op == "remove":
                del parent[token]
            else:
                parent[token] = copy.deepcopy(operation.get("value"))
        elif isinstance(parent, list):
            if token == "-" and op == "add":
                parent.append(copy.deepcopy(operation.get("value")))
                continue
            try:
                index = int(token)
            except ValueError as exc:
                raise PlatformError("generation_patch_invalid", "数组 Patch 索引无效", 422) from exc
            if index < 0 or index >= len(parent):
                raise PlatformError("generation_patch_invalid", "数组 Patch 索引越界", 422)
            if op == "remove":
                parent.pop(index)
            elif op == "replace":
                parent[index] = copy.deepcopy(operation.get("value"))
            else:
                parent.insert(index, copy.deepcopy(operation.get("value")))
        else:
            raise PlatformError("generation_patch_invalid", "Patch 父路径不是容器", 422)
    return result


def select_operations(operations, indexes):
    if indexes is None:
        return copy.deepcopy(operations)
    if not isinstance(indexes, list) or not indexes:
        raise PlatformError("generation_patch_selection_invalid", "至少选择一个 Patch 字段", 422)
    if not all(isinstance(item, int) for item in indexes):
        raise PlatformError("generation_patch_selection_invalid", "Patch 字段索引必须是整数", 422)
    unique = sorted(set(indexes))
    if unique[0] < 0 or unique[-1] >= len(operations):
        raise PlatformError("generation_patch_selection_invalid", "Patch 字段索引越界", 422)
    return [copy.deepcopy(operations[index]) for index in unique]


def _join(pointer, token):
    escaped = str(token).replace("~", "~0").replace("/", "~1")
    return f"{pointer}/{escaped}"


def _resolve_parent(document, pointer):
    if not pointer.startswith("/"):
        raise PlatformError("generation_patch_invalid", "JSON Pointer 必须以 / 开始", 422)
    tokens = [
        item.replace("~1", "/").replace("~0", "~")
        for item in pointer[1:].split("/")
    ]
    current = document
    for token in tokens[:-1]:
        if isinstance(current, dict) and token in current:
            current = current[token]
        elif isinstance(current, list) and token.isdigit() and int(token) < len(current):
            current = current[int(token)]
        else:
            raise PlatformError("generation_patch_invalid", "Patch 路径不存在", 422)
    return current, tokens[-1]
