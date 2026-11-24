"""Build the review PDF from the repeated density-based pressure test."""

import argparse
import json
import math
import os
import runpy
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

from reportlab.graphics.shapes import Drawing, Line, Rect, String
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.platypus import PageBreak, SimpleDocTemplate, Spacer

SOURCE = Path(__file__).resolve().parent.parent
LAYOUT = SimpleNamespace(**runpy.run_path(str(SOURCE / "scripts/build-c200-report.py")))
WIDTH = LAYOUT.WIDTH
LOAD_COLORS = (LAYOUT.BLUE, LAYOUT.AMBER)
p = LAYOUT.p


def groups(workload):
    return {row["id"]: row for row in workload["groups"]}


def mean(group, metric):
    return group["averages"][metric]["mean"]


def delta(group, metric):
    return group["deltaAgainstControl"][metric]


def partial(workload, group):
    return workload["effectiveRequests"] - mean(group, "unserved") - mean(group, "complete")


def capacity_minutes(data):
    return data["seatCount"] * (data["close"] - data["open"]) / 60


def first_failure_rate(workload, group):
    return 100 * mean(group, "firstFailed") / workload["effectiveRequests"]


def value_and_change(value, change=None, digits=1, unit=""):
    result = f"{value:.{digits}f}{unit}"
    return result if change is None else f"{result} ({change:+.{digits}f})"


def policy_value(group, metric):
    change = None if group["id"] == "baseline-60" else delta(group, metric)["mean"]
    if metric == "occupancyPercent":
        return value_and_change(mean(group, metric), change, 3, "%")
    return value_and_change(mean(group, metric), change)


def start_time_profile(data):
    workloads = data["workloads"]
    series = [
        (workloads[0]["observedBinCounts"], colors.HexColor("#B7C7D4"), "原有有效预约"),
        (workloads[0]["addedBinCounts"], LOAD_COLORS[0], "+50% 新增"),
        (workloads[1]["addedBinCounts"], LOAD_COLORS[1], "+100% 新增"),
    ]
    axes = (29, WIDTH - 13, 25, 113)
    left, right, bottom, top = axes
    figure = Drawing(WIDTH, 145)
    peak = max(max(counts) for counts, _, _ in series)
    tick = max(1, math.ceil(peak / 5))
    maximum = math.ceil(peak / tick) * tick
    for count in range(0, maximum + 1, tick):
        y = bottom + (top - bottom) * count / maximum
        figure.add(Line(left, y, right, y, strokeColor=LAYOUT.LINE, strokeWidth=0.6))
        figure.add(String(left - 5, y - 3, str(count), textAnchor="end",
                          fontName=LAYOUT.REGULAR, fontSize=8, fillColor=LAYOUT.MUTED))
    n = len(series[0][0])
    bucket_width = (right - left) / n
    bar_width = bucket_width * 0.24
    for offset, (counts, color, label) in enumerate(series):
        for i, count in enumerate(counts):
            if count:
                x = left + bucket_width * (i + 0.14) + offset * bar_width
                height = (top - bottom) * count / maximum
                figure.add(Rect(x, bottom, bar_width, height, fillColor=color, strokeColor=None))
        label_x = 65 + offset * 143
        figure.add(Rect(label_x - 13, 129, 9, 6, fillColor=color, strokeColor=None))
        figure.add(String(label_x, 128, label, fontName=LAYOUT.REGULAR, fontSize=9, fillColor=LAYOUT.INK))
    for i in [index for index in range(0, n, 6) if index <= n - 3] + [n]:
        x = left + i * bucket_width
        instant = min(data["close"], data["open"] + i * data["binMinutes"] * 60)
        figure.add(String(x, bottom - 12, LAYOUT.clock(instant), textAnchor="middle",
                          fontName=LAYOUT.REGULAR, fontSize=8.5, fillColor=LAYOUT.MUTED))
    return figure


def overview(data, review_date):
    runs = len(data["seeds"])
    variants = (
        ("baseline-60", "<b>单座基线</b>"),
        ("stitch-60", "仅拼接"),
        ("renew-60", "仅续座"),
        ("both-60", "拼接＋续座"),
    )
    result_rows, fallback_rows, baseline_partial = [], [], []
    fallback_improvements = 0
    for workload in data["workloads"]:
        load = f"+{workload['increasePercent']}%"
        policies = groups(workload)
        control, short = policies["baseline-60"], policies["baseline-45"]
        for policy_id, label in variants:
            group = policies[policy_id]
            result_rows.append([load, label, policy_value(group, "firstFailed"),
                                f"{first_failure_rate(workload, group):.1f}%",
                                policy_value(group, "complete"), policy_value(group, "occupancyPercent"),
                                f"{mean(group, 'switches'):.1f}"])
        partial_control = partial(workload, control)
        partial_short = partial(workload, short)
        rate_short, rate_control = first_failure_rate(workload, short), first_failure_rate(workload, control)
        fallback_rows.append([load, policy_value(short, "firstFailed"),
                              value_and_change(rate_short, rate_short - rate_control, unit="%"),
                              policy_value(short, "complete"), value_and_change(partial_short, partial_short - partial_control),
                              policy_value(short, "occupancyPercent")])
        baseline_partial.append(f"{partial_control:.1f}")
        fallback_improvements += delta(short, "firstFailed")["lowerRuns"]

    first, second = data["workloads"]
    double_groups = groups(second)
    control, combined = double_groups["baseline-60"], double_groups["both-60"]
    baseline_highlights = [
        ("BACKGROUND", (0, i), (-1, i), LAYOUT.TEAL_WASH)
        for i in range(1, len(result_rows) + 1, len(variants))
    ]
    return [
        p("C200 东区座位预约压力测试", LAYOUT.TITLE),
        p(f"SeatLink　|　预约数据 {data['date']}　|　审阅 {review_date}", LAYOUT.SUBTITLE),
        LAYOUT.box([
            "<b>基线只分配一个连续单座时段，至少 60 分钟，拼接和续座均关闭。</b><br/>"
            f"需求翻倍时，基线每轮平均首约失败 {mean(control, 'firstFailed'):.1f} 条"
            f"（{first_failure_rate(second, control):.1f}%），全天预约利用率为 {mean(control, 'occupancyPercent'):.3f}%。",
            "<b>需求翻倍且同时开启拼接和续座时，</b>"
            f"每轮比基线多 {delta(combined, 'firstFailed')['mean']:.1f} 条首约失败，"
            f"完整覆盖少 {abs(delta(combined, 'complete')['mean']):.1f} 条，"
            f"预约利用率下降 {abs(delta(combined, 'occupancyPercent')['mean']):.3f} 个百分点。",
        ]),
        p("固定 60 分钟下限的四组对照", LAYOUT.HEADING),
        p(f"+50% 与 +100% 分别有 {first['effectiveRequests']} 和 {second['effectiveRequests']} 条有效请求，"
          f"各取 {runs} 次回放均值。<br/>括号内为相对同档基线的变化。失败率和利用率的变化用百分点。", LAYOUT.SMALL),
        LAYOUT.table(["需求", "策略", "首约失败<br/>条", "失败率", "完整覆盖<br/>条", "预约利用率", "换座<br/>次"],
                     result_rows, [48, 74, 83, 61, 82, 108, WIDTH - 456], numeric=tuple(range(2, 7)),
                     extra=baseline_highlights),
        p("45 分钟单座兜底与基线对照", LAYOUT.HEADING),
        LAYOUT.table(["需求", "首约失败<br/>条", "失败率", "完整覆盖<br/>条", "只覆盖部分<br/>条", "预约利用率"],
                     fallback_rows, [53, 89, 90, 83, 87, WIDTH - 402], numeric=tuple(range(1, 6))),
        Spacer(1, 6),
        p(f"基线的部分覆盖在两档分别为 {baseline_partial[0]} 和 {baseline_partial[1]} 条，差值按原始精度计算。"
          f"<br/>45 分钟兜底在 {fallback_improvements}/{runs * len(data['workloads'])} 次配对回放中减少了首约失败。", LAYOUT.SMALL),
        p("<b>默认单座至少 60 分钟。</b>无法提供至少 60 分钟的连续空位时，由读者选择是否接受 45-59 分钟。"),
    ]


def methods(data):
    first, second = data["workloads"]
    capacity = capacity_minutes(data)
    load_rows = []
    for workload in data["workloads"]:
        demand = workload["totalEffectiveDemandMinutes"]["mean"]
        load_rows.append([f"+{workload['increasePercent']}%", workload["addedCount"], workload["totalRequests"],
                          workload["effectiveRequests"], f"{demand:,.0f}", f"{100 * demand / capacity:.1f}%"])
    duration_rows = []
    for label, summary in [
        ("原有有效预约", data["sourceDurationMinutes"]),
        ("+50% 新增", first["durationMinutes"]),
        ("+100% 新增", second["durationMinutes"]),
    ]:
        duration_rows.append([label, f"{summary['min']:.0f}", f"{summary['median']:.1f}",
                              f"{summary['mean']:.1f}", f"{summary['max']:.0f}"])
    return [
        p("按时段密度生成模拟请求", LAYOUT.PAGE_TITLE),
        p(f"保留 C200 东区当日 {data['sourceRequests']} 条原始预约，用 {data['sourceEffectiveRequests']} 条有效预约估计分布。"
          "有效结束取日志中的真实结束与预约结束的较早时刻。有效结束晚于预约开始的请求计入有效需求。"),
        p(f"回放使用预约记录中的 {data['seatCount']} 座，时段为 {LAYOUT.interval(data['open'], data['close'])}，"
          f"全天容量为 {capacity:,.0f} 座位分钟。", LAYOUT.SMALL),
        LAYOUT.table(["需求", "新增请求", "总请求", "有效请求", "有效需求<br/>座位分钟", "需求 / 容量"],
                     load_rows, [61, 74, 71, 75, 106, WIDTH - 387], numeric=tuple(range(1, 6))),
        p("1  按半小时分配新增量", LAYOUT.HEADING),
        p("用原始请求数乘加量比例并向上取整，得到新增总量。"
          "按期望开始时刻统计每半小时的有效预约占比，据此分配新增量。各时段先向下取整，再按余数从大到小补齐。"),
        start_time_profile(data),
        p("柱高表示各半小时内原有有效预约数和两档模拟新增数。", LAYOUT.SMALL),
        p("2  抽取开始时刻和期望时长", LAYOUT.HEADING),
        p(f"在该时段的合法分钟内等概率抽取开始时刻，至少留出 {data['durationMinimumMinutes']} 分钟到闭馆。"
          f"期望时长下限为 {data['durationMinimumMinutes']} 分钟，上限取 {data['durationMaximumMinutes']} 分钟与闭馆前剩余时长的较小值。"
          "从同一时段随机取一条原预约，将其期望时长在上下界之间的相对位置映射到新请求的允许区间。"
          f"在映射值前后 {data['durationJitterMinutes']} 分钟内随机抽取符合上下界的整数分钟。"),
        LAYOUT.table(["期望时长（分钟）", "最短", "中位数", "均值", "最长"], duration_rows,
                     [141, 78, 92, 90, WIDTH - 401], numeric=(1, 2, 3, 4)),
        p("3  抽取提交时间和释放时刻", LAYOUT.HEADING),
        p("从同一时段分别抽取提交提前量和有效时长占期望时长的比例。"
          "将提前量应用到新开始时刻，将比例应用到新期望时长，得到提交时间和有效结束时刻。"
          "原预约沿用日志中的提交、起止和释放时刻。"),
        p(f"每档使用种子 {data['seeds'][0]} 至 {data['seeds'][-1]}。每个种子下，所有策略共用同一批请求。"
          "回放按事件时刻推进，释放的时段在事件发生后可重新分配。", LAYOUT.SMALL),
    ]


def policy_label(row):
    if row["id"] == "baseline-waitlist":
        return "60 分钟，释放后候补"
    if row["id"] == "baseline-waitlist-at-start":
        return "60 分钟，到点后候补"
    base = {"baseline": "单座", "stitch": "仅拼接", "renew": "仅续座", "both": "拼接＋续座"}[row["basePolicy"]]
    minutes = row["minFirstSegmentMinutes"]
    suffix = "<br/>逐段确认" if "confirmLeadMinutes" in row else ""
    return f"{minutes} 分钟 {base}{suffix}"


def comparison(data):
    first, second = data["workloads"]
    second_groups = groups(second)
    rows = []
    short_row = 0
    for item in first["groups"]:
        values = [policy_label(item)]
        for row in (item, second_groups[item["id"]]):
            values += [f"{delta(row, 'firstFailed')['mean']:+.1f}", f"{delta(row, 'complete')['mean']:+.1f}",
                       f"{delta(row, 'occupancyPercent')['mean']:+.3f}", f"{mean(row, 'switches'):.1f}"]
        rows.append(values)
        if item["id"] == "baseline-45":
            short_row = len(rows)
    baseline = second_groups["baseline-60"]
    single45 = second_groups["baseline-45"]
    stitch45 = second_groups["stitch-45"]
    eager = second_groups["both-60"]
    deferred = second_groups["both-60-deferred"]
    waitlist = second_groups["baseline-waitlist"]
    load_widths = [53, 53, 43, 41]
    widths = [WIDTH - 2 * sum(load_widths)] + load_widths * 2
    return [
        p("策略对照与指标口径", LAYOUT.PAGE_TITLE),
        p(f"每档以 60 分钟单座单段为基线，按种子配对，共 {len(data['seeds'])} 次。"
          "拼接允许首约安排多个时段，续座允许在已有预约后追加时段。"
          f"首段下限为 {data['policyMinimumMinutes']} 或 60 分钟，后续段至少 60 分钟。45 分钟组按读者接受短段回放。", LAYOUT.SMALL),
        LAYOUT.table(
            ["策略（首段下限）", "+50%<br/>首约失败", "+50%<br/>完整覆盖", "+50%<br/>利用率", "+50%<br/>换座",
             "+100%<br/>首约失败", "+100%<br/>完整覆盖", "+100%<br/>利用率", "+100%<br/>换座"],
            rows, widths, numeric=tuple(range(1, 9)),
            extra=[("BACKGROUND", (0, short_row), (-1, short_row), LAYOUT.TEAL_WASH),
                   ("LINEBEFORE", (5, 0), (5, -1), 0.6, LAYOUT.LINE)],
        ),
        Spacer(1, 6),
        p("首约失败、完整覆盖和预约利用率为相对对照的平均变化，单位依次为条、条、百分点。"
          "换座为每轮回放安排的平均次数。", LAYOUT.SMALL),
        p(f"<b>需求翻倍。</b>45 分钟仅拼接相对单座，每轮多安排 "
          f"{mean(stitch45, 'switches') - mean(single45, 'switches'):.1f} 次换座，"
          f"完整覆盖少 {mean(single45, 'complete') - mean(stitch45, 'complete'):.1f} 条。"
          f"60 分钟组合改为逐段确认后，换座从 {mean(eager, 'switches'):.1f} 次降至 {mean(deferred, 'switches'):.1f} 次。"
          f"释放后候补相对对照，最终无座减少 {mean(baseline, 'unserved') - mean(waitlist, 'unserved'):.1f} 条，"
          f"完整覆盖减少 {mean(baseline, 'complete') - mean(waitlist, 'complete'):.1f} 条。", LAYOUT.SMALL),
        p("指标口径", LAYOUT.HEADING),
        LAYOUT.table(
            ["指标", "计算口径"],
            [
                ["首约失败与失败率", "提交时未配到预约的有效请求计为首约失败。<br/>"
                 "失败率为失败数除以有效请求总数，后来候补成功仍计入首约失败。"],
                ["完整与部分覆盖", "从期望开始到有效结束全程有座为完整覆盖。分到了座位、仍存在未覆盖时段为部分覆盖。"],
                ["预约利用率", "有效分配座位分钟除以全天容量。有效分配时段在有效结束时截断。"],
                ["换座次数", "同一请求相邻的两个有效分配段使用不同座位时计一次。"],
            ],
            [120, WIDTH - 120],
        ),
        Spacer(1, 6),
        p("逐段确认每次只锁一段，在尾段结束前 15 分钟进入续座确认窗口。"
          "候补允许比目标时刻最多晚 30 分钟开始。", LAYOUT.SMALL),
        p("在 source 目录运行 npm run experiment:c200:density，逐种子结果与汇总位于 .qa/c200-density-pressure-45min.json。", LAYOUT.SMALL),
    ]


def draw_page(canvas, doc):
    width, height = A4
    margin = LAYOUT.MARGIN
    canvas.setFillColor(LAYOUT.BLUE)
    canvas.setFont(LAYOUT.BOLD, 9)
    canvas.drawString(margin, height - 31, "SeatLink")
    canvas.setFillColor(LAYOUT.MUTED)
    canvas.setFont(LAYOUT.REGULAR, 9)
    canvas.drawRightString(width - margin, height - 31, "C200 东区随机需求压力测试")
    canvas.setStrokeColor(LAYOUT.LINE)
    canvas.line(margin, height - 40, width - margin, height - 40)
    canvas.line(margin, 37, width - margin, 37)
    canvas.drawString(margin, 23, "实验说明　·　审阅稿")
    canvas.drawRightString(width - margin, 23, f"{doc.page:02d} / 03")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--summary", type=Path, default=SOURCE / ".qa/c200-density-pressure-45min.json")
    parser.add_argument("--output", type=Path,
                        default=SOURCE.parent.parent / "output/pdf/SeatLink-C200随机需求压力测试.pdf")
    parser.add_argument("--review-date", default=datetime.now(tz=LAYOUT.LOCAL_TIME).date().isoformat())
    args = parser.parse_args()
    data = json.loads(args.summary.read_text(encoding="utf-8"))
    LAYOUT.load_fonts()
    story = [*overview(data, args.review_date), PageBreak(), *methods(data), PageBreak(), *comparison(data)]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_name(f"{args.output.stem}.{os.getpid()}.tmp.pdf")
    try:
        doc = SimpleDocTemplate(
            str(temporary), pagesize=A4, leftMargin=LAYOUT.MARGIN, rightMargin=LAYOUT.MARGIN,
            topMargin=53, bottomMargin=45, title="SeatLink C200 随机需求压力测试", author="SeatLink 项目",
        )
        doc.build(story, onFirstPage=draw_page, onLaterPages=draw_page)
        temporary.replace(args.output)
    finally:
        temporary.unlink(missing_ok=True)
    print(args.output)


if __name__ == "__main__":
    main()
