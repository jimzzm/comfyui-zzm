"""音频时长 — 读 AUDIO 的实际秒数，产出 FLOAT（秒）。

替掉 SoundFlow 插件的 `SoundFlow_GetLength`：整个 soundflow 包只为这一个
AUDIO → FLOAT 的转换，装一整套不划算，这里 20 行写完。

ComfyUI 的 AUDIO 就是 `{"waveform": Tensor[B, C, T], "sample_rate": int}`，
时长 = 采样点总数 / 采样率；多声道、多批次都取同一时间轴（不叠加）。

输出和 SoundFlow 一致，直接接 ComfyNumberConvert / ComfyMathExpression
去算帧数（H3 的 length 要 17 对齐，那部分仍由工作流里的表达式节点负责）。
"""


class AudioDuration:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "audio": ("AUDIO",),
            }
        }

    RETURN_TYPES = ("FLOAT", "INT")
    RETURN_NAMES = ("seconds", "milliseconds")
    FUNCTION = "duration"
    CATEGORY = "⚡ zzm工具箱"
    SEARCH_ALIASES = ["zzm", "audio", "duration", "length", "音频时长"]

    def duration(self, audio):
        if audio is None:
            return (0.0, 0)
        waveform = audio["waveform"]
        sample_rate = int(audio["sample_rate"])
        if sample_rate <= 0:
            return (0.0, 0)
        # waveform 可能带 batch 维：[B, C, T] 或 [C, T]
        samples = int(waveform.shape[-1])
        seconds = samples / float(sample_rate)
        return (seconds, int(round(seconds * 1000)))
