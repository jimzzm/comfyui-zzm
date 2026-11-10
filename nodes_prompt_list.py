# ---------------------------------------------------------------------------
# 多段提示词（逐条队列模式）
#
# 为什么不用 list 展开：
#   内核的 list 展开是「按节点」展开，不是「按条」展开 —— 58 条的 conditioning
#   全部编码完才去采样，58 个 latent 全部采样完才去解码，所有中间结果要作为
#   列表累积驻留到最后一个节点结束。条数一多（尤其带放大的工作流）必爆显存。
#
# 这里的做法：每次只让一条提示词通过，跑完整条工作流 → 存图 → 释放，
# 然后在 PromptQueue.task_done 里自动把下一条排进队列。
# 对 ComfyUI 来说就是 N 个连续的独立任务，显存占用与单张出图完全相同。
# ---------------------------------------------------------------------------
import copy
import re
import threading
import time
import uuid

MODE_AUTO = "自动（空行优先，无空行按换行）"
MODE_BLANK = "空行分段"
MODE_LINE = "每行一段"
MODE_SPACE = "空格分段（中文提示词常用）"
MODE_CUSTOM = "自定义分隔符"

UINT64_MAX = 0xFFFFFFFFFFFFFFFF
INDEX_INPUT = "当前索引"

# prompt_id -> 本次执行的续排状态
_RUN_STATE = {}
_STATE_LOCK = threading.Lock()
_HOOK_INSTALLED = False


# ---------------------------------------------------------------------------
# 队列钩子：一条跑完，自动排下一条
# ---------------------------------------------------------------------------
def _queue_next(queue, item):
    prompt_id = item[1]
    with _STATE_LOCK:
        state = _RUN_STATE.pop(prompt_id, None)
    if not state:
        return

    total = state["total"]
    nxt = state["index"] + 1
    if nxt > total:
        print(f"\033[34m[AI-zzm] 全部完成：{total} 条已依次执行完毕\033[0m", flush=True)
        return

    prompt = copy.deepcopy(state["prompt"])
    node = prompt.get(state["node_id"])
    if not isinstance(node, dict):
        print("[AI-zzm] 续排中止：原始 prompt 里找不到本节点")
        return
    node.setdefault("inputs", {})[INDEX_INPUT] = nxt

    extra_data = dict(item[3]) if isinstance(item[3], dict) else {}
    extra_data["create_time"] = int(time.time() * 1000)
    sensitive = item[5] if len(item) > 5 else {}

    try:
        number = getattr(queue.server, "number", 0)
        queue.server.number = number + 1
    except Exception:
        number = 0

    queue.put((number, str(uuid.uuid4()), prompt, extra_data, item[4], sensitive))
    print(f"\033[34m[AI-zzm] 已排队第 {nxt}/{total} 条\033[0m", flush=True)


def install_queue_hook():
    """包一层 PromptQueue.task_done —— 它在每条任务结束时被无条件调用。"""
    global _HOOK_INSTALLED
    if _HOOK_INSTALLED:
        return
    try:
        from execution import PromptQueue
    except Exception as e:  # 非 ComfyUI 环境（做单测时）直接跳过
        print(f"[AI-zzm] 队列钩子未安装：{e}")
        return
    if getattr(PromptQueue, "_zzm_queue_hook", False):
        _HOOK_INSTALLED = True
        return

    original = PromptQueue.task_done

    def patched(self, item_id, history_result, status=None, process_item=None):
        # 必须在 pop 之前取，task_done 内部会把它从 currently_running 移除
        item = self.currently_running.get(item_id)
        result = original(self, item_id, history_result, status, process_item)
        if item is None:
            return result
        if status is not None and getattr(status, "completed", False):
            try:
                _queue_next(self, item)
            except Exception as e:
                print(f"[AI-zzm] 自动续排失败（本条已出图，后续需手动点队列）: {e}")
        else:
            # 失败 / 被取消：清掉状态，队列停在这里，不再往下排
            with _STATE_LOCK:
                state = _RUN_STATE.pop(item[1], None)
            if state:
                print(f"[AI-zzm] 第 {state['index']}/{state['total']} 条未成功"
                      f"（出错或已取消），队列已停止", flush=True)
        return result

    PromptQueue.task_done = patched
    PromptQueue._zzm_queue_hook = True
    _HOOK_INSTALLED = True
    print("[AI-zzm] 多段提示词：逐条队列钩子已安装", flush=True)


# ---------------------------------------------------------------------------
# 分段工具
# ---------------------------------------------------------------------------
def _as_scalar(value, default):
    if value is None:
        return default
    if isinstance(value, (list, tuple)):
        return value[0] if len(value) > 0 else default
    return value


_BAD_LITERALS = {"false", "true", "none", "null"}
_WARNED_LITERAL = False


def _as_text(value):
    """统一前缀 / 统一后缀的取值防御。

    旧工作流（v1 只有 7 个控件）加载到 v2（多了「当前索引」）时，前端按位置填
    widgets_values，值会整体右移一位，把「去重」的布尔塞进「统一后缀」——
    实际落地成字符串 "False"，会被原样拼进每条提示词。
    这里把布尔和 "False"/"True"/"None" 这类字面量都当空串，避免静默污染。
    """
    global _WARNED_LITERAL
    if not isinstance(value, str):
        return ""
    v = value.strip()
    if v.lower() in _BAD_LITERALS:
        if not _WARNED_LITERAL:
            _WARNED_LITERAL = True
            print(f"[AI-zzm] 警告：统一前缀/后缀 的值是 {v!r}，疑似旧工作流 widget 错位，"
                  f"已按空串处理（把节点上那个框清空即可，本提示只出现一次）", flush=True)
        return ""
    return value


def _as_int(value, default):
    if isinstance(value, bool):
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _as_bool(value):
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return bool(value)


def split_text(text, mode, sep):
    text = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        return [""]

    if mode == MODE_CUSTOM:
        sep = sep.replace("\\n", "\n").replace("\\t", "\t")
        return text.split(sep) if sep else [text]
    if mode == MODE_SPACE:
        return re.split(r"[ \t\u3000\u00a0]+", text)
    if mode == MODE_LINE:
        return text.split("\n")
    if mode == MODE_BLANK:
        return re.split(r"\n[ \t]*\n\s*", text)

    parts = re.split(r"\n[ \t]*\n\s*", text)
    if len([p for p in parts if p.strip()]) <= 1:
        parts = text.split("\n")
    return parts


def _clean_parts(parts, prefix, suffix, dedup, limit):
    out, seen = [], set()
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if dedup:
            if p in seen:
                continue
            seen.add(p)
        out.append(f"{prefix}{p}{suffix}")
    if not out:
        out = [""]
    if limit and limit > 0:
        out = out[:limit]
    return out


def _preview(out, head=20):
    lines = []
    for i, p in enumerate(out[:head]):
        one = " ".join(p.split())
        if len(one) > 70:
            one = one[:70] + "…"
        lines.append(f"{i + 1:02d}. {one}")
    if len(out) > head:
        lines.append(f"… 另有 {len(out) - head} 段")
    return f"共 {len(out)} 段\n" + "\n".join(lines)


# ---------------------------------------------------------------------------
# 多段提示词：逐条模式（默认，推荐）
# ---------------------------------------------------------------------------
class PromptList:
    """每次只输出一条，跑完自动排下一条 —— 显存占用与单张出图一致。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "文本": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "dynamicPrompts": False,
                }),
                "分隔方式": (
                    [MODE_AUTO, MODE_BLANK, MODE_LINE, MODE_SPACE, MODE_CUSTOM],
                    {"default": MODE_AUTO},
                ),
                "自定义分隔符": ("STRING", {"default": "---", "multiline": False}),
                "当前索引": ("INT", {"default": 1, "min": 1, "max": 9999, "step": 1}),
            },
            "optional": {
                "统一前缀": ("STRING", {"default": "", "multiline": False}),
                "统一后缀": ("STRING", {"default": "", "multiline": False}),
                "去重": ("BOOLEAN", {"default": False}),
                "最大条数": ("INT", {"default": 0, "min": 0, "max": 9999}),
            },
            "hidden": {"prompt": "PROMPT"},
        }

    RETURN_TYPES = ("STRING", "INT", "STRING", "INT")
    RETURN_NAMES = ("提示词", "段数", "分段预览", "序号")
    FUNCTION = "pick_prompt"
    CATEGORY = "⚡ zzm工具箱"
    SEARCH_ALIASES = ["zzm", "prompt list", "多段提示词", "批量提示词"]
    DESCRIPTION = (
        "逐条模式：每次只把一段送进工作流，整条链跑完存完图，内核自动排下一段。\n"
        "· 一次点击 = 依次出 N 张，每张独立执行，显存/内存不累积（58 条也不会爆）\n"
        "· 某一条失败或你点了取消，队列就停在那里，不会继续往下排\n"
        "· 「当前索引」可以从中间开始跑；「序号」输出可接「保存图片」等需要当前条号的节点\n"
        "· 分隔方式：自动（默认，有空行按空行、没空行按换行）/ 空行 / 每行一段 / 空格 / 自定义"
    )

    def pick_prompt(self, 文本, 分隔方式, 自定义分隔符, 当前索引=1,
                    统一前缀="", 统一后缀="", 去重=False, 最大条数=0, prompt=None):
        parts = split_text(文本, 分隔方式, 自定义分隔符)
        out = _clean_parts(
            parts,
            _as_text(统一前缀),
            _as_text(统一后缀),
            _as_bool(去重),
            _as_int(最大条数, 0),
        )
        total = len(out)

        idx = max(1, min(_as_int(当前索引, 1), total))
        text = out[idx - 1]

        # 登记续排状态：拿到内核为本次执行分配的 prompt_id 与节点 id
        try:
            from comfy_execution.utils import get_executing_context
            ctx = get_executing_context()
        except Exception:
            ctx = None

        if ctx is not None and prompt is not None and total > 1:
            with _STATE_LOCK:
                if len(_RUN_STATE) > 32:
                    _RUN_STATE.pop(next(iter(_RUN_STATE)), None)
                exist = _RUN_STATE.get(ctx.prompt_id)
                if exist is not None and exist["node_id"] != ctx.node_id:
                    print("[AI-zzm] 警告：一次执行里接了多个「多段提示词」节点，只有第一个会自动续排")
                else:
                    _RUN_STATE[ctx.prompt_id] = {
                        "node_id": ctx.node_id,
                        "index": idx,
                        "total": total,
                        "prompt": prompt,
                    }

        if idx == 1:
            print(f"[AI-zzm] 逐条模式：共 {total} 段，开始依次执行", flush=True)
            print(_preview(out))
        else:
            print(f"[AI-zzm] 第 {idx}/{total} 段")

        return (text, total, _preview(out), idx)


# ---------------------------------------------------------------------------
# 多段提示词：列表模式（旧行为，一次跑完，条数多会爆显存）
# ---------------------------------------------------------------------------
class PromptListBatch:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "文本": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "dynamicPrompts": False,
                }),
                "分隔方式": (
                    [MODE_AUTO, MODE_BLANK, MODE_LINE, MODE_SPACE, MODE_CUSTOM],
                    {"default": MODE_AUTO},
                ),
                "自定义分隔符": ("STRING", {"default": "---", "multiline": False}),
            },
            "optional": {
                "统一前缀": ("STRING", {"default": "", "multiline": False}),
                "统一后缀": ("STRING", {"default": "", "multiline": False}),
                "去重": ("BOOLEAN", {"default": False}),
                "最大条数": ("INT", {"default": 0, "min": 0, "max": 500}),
            },
        }

    RETURN_TYPES = ("STRING", "INT", "STRING")
    RETURN_NAMES = ("提示词", "段数", "分段预览")
    OUTPUT_IS_LIST = (True, False, False)
    FUNCTION = "split_prompts"
    CATEGORY = "⚡ zzm工具箱"
    SEARCH_ALIASES = ["zzm", "prompt list", "多段提示词", "批量提示词"]
    DESCRIPTION = (
        "列表模式：一次把 N 段全部灌进下游，内核按 list 展开执行。\n"
        "⚠ 所有中间结果会累积到最后一刻才释放 —— 3~5 段还行，几十段配放大必爆显存。\n"
        "条数多请用「多段提示词」（逐条模式）。"
    )

    def split_prompts(self, 文本, 分隔方式, 自定义分隔符,
                      统一前缀="", 统一后缀="", 去重=False, 最大条数=0):
        out = _clean_parts(
            split_text(文本, 分隔方式, 自定义分隔符),
            _as_text(统一前缀),
            _as_text(统一后缀),
            _as_bool(去重),
            _as_int(最大条数, 0),
        )
        print(f"[AI-zzm] 列表模式：{len(out)} 段（注意：全部驻留内存）")
        return (out, len(out), _preview(out))

