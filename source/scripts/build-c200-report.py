"""Build the Chinese review PDF from the generated replay summary."""

import argparse
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from reportlab.graphics.shapes import Drawing, Line, PolyLine, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

SOURCE = Path(__file__).resolve().parent.parent
LOCAL_TIME = timezone(timedelta(hours=8))
INK = colors.HexColor("#203349")
MUTED = colors.HexColor("#4E6275")
BLUE = colors.HexColor("#156080")
AMBER = colors.HexColor("#966327")
LINE = colors.HexColor("#D8E3EB")
WASH = colors.HexColor("#EEF5F9")
TEAL_WASH = colors.HexColor("#E6F2EF")
REGULAR = "Deng"
BOLD = "DengBold"
MARGIN = 45
WIDTH = A4[0] - 2 * MARGIN


def load_fonts():
    root = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    pdfmetrics.registerFont(TTFont(REGULAR, str(root / "Deng.ttf")))
    pdfmetrics.registerFont(TTFont(BOLD, str(root / "Dengb.ttf")))
    pdfmetrics.registerFontFamily(REGULAR, normal=REGULAR, bold=BOLD)


def style(name, font=REGULAR, size=10.8, leading=17, color=INK, **kwargs):
    return ParagraphStyle(name, fontName=font, fontSize=size, leading=leading,
                          textColor=color, wordWrap="CJK", **kwargs)


TITLE = style("title", BOLD, 28, 36)
PAGE_TITLE = style("page-title", BOLD, 23, 30, spaceAfter=10)
SUBTITLE = style("subtitle", REGULAR, 13, 20, MUTED, spaceAfter=10)
HEADING = style("heading", BOLD, 13, 19, BLUE, spaceBefore=11, spaceAfter=5)
BODY = style("body", spaceAfter=7)
SMALL = style("small", size=9.3, leading=14, color=MUTED, spaceAfter=5)
CELL = style("cell", size=9.5, leading=13, alignment=TA_LEFT)
RIGHT = style("right", size=9.5, leading=13, alignment=TA_RIGHT)
HEAD = style("head", font=BOLD, size=9.4, leading=12)
HEAD_RIGHT = style("head-right", font=BOLD, size=9.4, leading=12, alignment=TA_RIGHT)
CODE = style("code", size=9.7, leading=15, color=BLUE)


def p(value, paragraph_style=BODY):
    return Paragraph(str(value), paragraph_style)


def seat_minutes(seconds):
    return f"{seconds / 60:,.2f}"


def clock(seconds, include_seconds=False):
    fmt = "%H:%M:%S" if include_seconds else "%H:%M"
    return datetime.fromtimestamp(seconds, tz=LOCAL_TIME).strftime(fmt)


def interval(start, end):
    return f"{clock(start)}-{clock(end)}"


def table(headers, rows, widths, numeric=(), extra=()):
    header = [p(title, HEAD_RIGHT if i in numeric else HEAD) for i, title in enumerate(headers)]
    cells = [[p(value, RIGHT if i in numeric else CELL) for i, value in enumerate(row)] for row in rows]
    report_table = Table([header, *cells], colWidths=widths, hAlign="LEFT", repeatRows=1)
    report_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), WASH),
        ("LINEBELOW", (0, 0), (-1, 0), 0.7, colors.HexColor("#ACC1D1")),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        *extra,
    ]))
    return report_table


def box(lines, background=WASH):
    block = Table([[p(line)] for line in lines], colWidths=[WIDTH], hAlign="LEFT")
    block.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), background),
        ("LINEBEFORE", (0, 0), (0, -1), 2.5, BLUE),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 11),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return block


def time_profile(summary, observed, pressure):
    drawing = Drawing(WIDTH, 149)
    left, right, bottom, top = 37, WIDTH - 9, 24, 123
    start, end = summary["open"], summary["close"]
    step = summary["binSeconds"]
    for value in (0, 25, 50, 75, 100):
        y = bottom + (top - bottom) * value / 100
        drawing.add(Line(left, y, right, y, strokeColor=LINE, strokeWidth=0.6))
        drawing.add(String(left - 6, y - 3, f"{value}%", textAnchor="end",
                           fontName=REGULAR, fontSize=8, fillColor=MUTED))
    for time in [start + hour * 3600 for hour in (0, 3, 6, 9, 12)] + [end]:
        x = left + (right - left) * (time - start) / (end - start)
        drawing.add(String(x, bottom - 13, clock(time), textAnchor="middle",
                           fontName=REGULAR, fontSize=8.5, fillColor=MUTED))
    series = [
        (observed["groups"][0], BLUE, None, "原始请求，四组重合", 81),
        (pressure["groups"][0], AMBER, [4, 2], "压力负载，对照组", 270),
    ]
    for group, color, dash, label, label_x in series:
        points = []
        for index, seconds in enumerate(group["bins"]):
            start_bin = start + index * step
            seconds_in_bin = min(step, end - start_bin)
            position = (start_bin - start + seconds_in_bin / 2) / (end - start)
            fraction = seconds / (summary["seatCount"] * seconds_in_bin)
            points += [left + (right - left) * position, bottom + (top - bottom) * fraction]
        drawing.add(PolyLine(points, strokeColor=color, strokeWidth=1.75, strokeDashArray=dash))
        drawing.add(Line(label_x - 22, 137, label_x - 5, 137,
                         strokeColor=color, strokeWidth=1.75, strokeDashArray=dash))
        drawing.add(String(label_x, 134, label, fontName=REGULAR, fontSize=9, fillColor=INK))
    return drawing


def overview(summary, observed, pressure, reviewed_on):
    obs_control = observed["groups"][0]
    stress_control = pressure["groups"][0]
    stress_renew = pressure["groups"][2]
    stress_both = pressure["groups"][3]
    assert all(group["bins"] == obs_control["bins"] for group in observed["groups"])
    obs_util = 100 * obs_control["utilization"]
    renew_gain = 100 * (stress_renew["utilization"] - stress_control["utilization"])
    both_gain = 100 * (stress_both["utilization"] - stress_control["utilization"])
    effective = observed["effectiveRequests"]
    story = [
        p("提前拼接与学习中续座", TITLE),
        p(f"C200 东区真实预约回放实验　|　数据 {summary['date']}　|　审阅 {reviewed_on}", SUBTITLE),
        box([
            f"<b>原始负载。</b>四组的预约利用率同为 <b>{obs_util:.3f}%</b>，均完整覆盖 {effective} 条有效请求。",
            f"<b>需求压力。</b>新增 {pressure['addedCount']} 条同型请求后，仅续座较对照组 <b>{renew_gain:+.3f}</b> 个百分点。"
            f"两项同时开启较对照组 <b>{both_gain:+.3f}</b> 个百分点。",
        ]),
        p("四组结果", HEADING),
    ]
    rows = []
    for name, run in (("原始请求", observed), ("需求压力", pressure)):
        baseline = run["groups"][0]["utilization"]
        for i, group in enumerate(run["groups"]):
            delta = 100 * (group["utilization"] - baseline)
            rows.append([
                f"{name}<br/>{run['totalRequests']} 条" if i == 0 else "",
                group["label"], seat_minutes(group["occupiedSeconds"]), f"{100*group['utilization']:.3f}%",
                f"{delta:+.3f}" if delta else "0.000",
                f"{group['complete']} / {run['effectiveRequests']}", group["switches"],
            ])
    story.extend([
        table(
            ["负载", "策略", "有效座位分钟", "预约利用率", "较对照<br/>百分点", "完整覆盖<br/>条数", "换座<br/>次数"],
            rows, [63, 78, 90, 72, 75, 77, WIDTH - 455], numeric=(2, 3, 4, 5, 6),
            extra=[
                ("SPAN", (0, 1), (0, 4)), ("SPAN", (0, 5), (0, 8)),
                ("BACKGROUND", (0, 1), (0, 8), WASH),
                ("BACKGROUND", (1, 7), (-1, 7), TEAL_WASH),
                ("LINEABOVE", (0, 5), (-1, 5), 0.8, colors.HexColor("#ACC1D1")),
            ],
        ),
        Spacer(1, 6),
        p("百分点差由未四舍五入的分子计算。完整覆盖以有正有效时长的请求为分母。", SMALL),
        p("全天分时预约利用率", HEADING),
        time_profile(summary, observed, pressure),
        p("每个数据点为 30 分钟内的有效座位分钟占比。两条线使用同一个座位池和开馆时段。", SMALL),
    ])
    return story


def methods(summary, observed, pressure):
    open_minutes = (summary["close"] - summary["open"]) // 60
    capacity_minutes = open_minutes * summary["seatCount"]
    timing = summary["timings"]
    policy = summary["rules"]
    return [
        p("数据与回放规则", PAGE_TITLE),
        p("数据来源和范围", HEADING),
        p(f"原表为 {summary['date']} 的交大图书馆主馆 C200 东区预约记录，共 {observed['totalRequests']} 条。"
          f"座位池取当日记录中出现的 {summary['seatCount']} 个编号。平面图标出 C200 全部预约座位 252 个。"
          "东区座位池依据日志定义，完整历史座位清单尚未核验。"),
        p(f"回放保留提交时间、预约起止及真实结束时间。{timing['noEffectiveTime']} 条记录的真实结束不晚于预约开始，"
          f"有效时长记为零。{timing['releasedDuringSlot']} 条在预约时段内提前释放，"
          f"{timing['endedAfterBooked']} 条晚于预约结束，按预约结束截断。"
          f"{timing['priorToDemoWindow']} 条提交早于 Demo 默认开约时刻，回放保留原时刻并固定目标日期。"),
        p("四组只改变首次与后续的段数规则", HEADING),
        table(
            ["策略", "首次预约", "学习开始后"],
            [
                ["对照组", "最多一段", "关闭追加"],
                ["仅拼接", "可一次安排多段", "关闭追加"],
                ["仅续座", "最多一段", "每次最多追加一段，可续原座或换座"],
                ["拼接＋续座", "可一次安排多段", "可追加，单次追加可组合多段"],
            ], [94, 126, WIDTH - 220],
        ),
        Spacer(1, 7),
        p(f"四组共用 SeatLink 的排程和提交函数，首段均从目标开始时刻起。各段至少 {policy['minSegmentMinutes']} 分钟，"
          f"一条请求最多换座 {policy['maxSwitches']} 次，每处空窗最多 {policy['maxGapMinutes']} 分钟。"
          "按规划器首选方案自动接受，部分安排可提交。座位环境偏好未加入排程。"),
        p("按事件时刻逐条重排", HEADING),
        p("同一时刻先处理释放，再处理首次预约，最后检查续座。同类请求按原提交时间排序，相同时间按表内行序。"
          "续座可在学习开始、其他预约提前释放或当前方案尾段结束时触发。查询只使用当时可见的空位。"
          "读者键只在本地用于检查同一读者的重叠时段。"),
        p(f"压力负载在原 {observed['totalRequests']} 条基础上追加 {pressure['addedCount']} 条。"
          "从按提交顺序排序的正时长请求中等距抽取，保留其时刻与时长，分配新的模拟读者键。"
          "四组收到相同的新增请求。"),
        p("指标口径", HEADING),
        p(f"预约利用率 = 有效分配座位分钟 ÷ {capacity_minutes:,}。"
          f"分母为 {summary['seatCount']} 座 × {open_minutes} 分钟"
          f"（{interval(summary['open'], summary['close'])}）。有效分配按真实结束时间裁剪，空窗扣除。"
          "完整覆盖指从目标开始到有效结束均有座位，换座统计有效分配中相邻段的座位变化。"),
    ]


def discussion(summary, observed, pressure):
    groups = pressure["groups"]
    control = groups[0]
    rows = [[
        g["label"], f"{g['improved']} / {g['reduced']}",
        f"{(g['occupiedSeconds'] - control['occupiedSeconds']) / 60:+,.2f}",
        g["served"], f"{g['stitched']} / {g['renewed']}",
    ] for g in groups]
    renew = groups[2]
    story = [
        p("结果解读与复现", PAGE_TITLE),
        p("压力下的请求变化", HEADING),
        p(f"仅续座多分配了 {seat_minutes(renew['occupiedSeconds'] - control['occupiedSeconds'])} 座位分钟，"
          f"完整覆盖条数仍为 {renew['complete']}。获得任意有效分配的请求从 {control['served']} 条变为 {renew['served']} 条。"
          "在同一批请求中，增加的座位分钟与减少的请求覆盖可以同时出现。"),
        table(["策略", "时长增加 / 减少<br/>请求数", "净增<br/>座位分钟", "获得分配<br/>请求数", "发生拼接 / 续座<br/>请求数"],
              rows, [102, 110, 89, 82, WIDTH - 383], numeric=(1, 2, 3, 4)),
        Spacer(1, 6),
        p("同一请求逐条与对照配对。拼接计首次多段，续座计至少成功追加一次。", SMALL),
    ]
    example = pressure["example"]
    if example:
        story.append(p("一个回放片段", HEADING))
        story.append(p(f"需求时段为 {interval(example['start'], example['end'])}。示例按四组有效分配时长差最大选取，"
                       "座位以字母代称。"))
        labels = {group["id"]: group["label"] for group in groups}
        example_rows = []
        for arm in example["groups"]:
            steps = []
            for decision in arm["decisions"]:
                action = "首约" if decision["action"] == "initial" else "追加"
                slots = "、".join(f"{slot['seat']} 座 {interval(slot['start'], slot['end'])}"
                                  for slot in decision["slots"])
                steps.append(f"{clock(decision['time'], True)} {action} {slots}")
            example_rows.append([labels[arm["id"]], "<br/>".join(steps) if steps else "未分配",
                                 seat_minutes(arm["occupiedSeconds"])])
        story.append(table(["策略", "决策时刻与分配", "有效分钟"], example_rows,
                           [102, WIDTH - 192, 90], numeric=(2,)))
    story.extend([
        p("适用范围", HEADING),
        p("单日原表记录的是已形成的预约，系统未记录的需求及其原始期望时长需要另行观测。"
          "压力负载是基于原表的假设场景。文中的利用率衡量分配到的预约时段，实际在座情况需要另行观测。"),
        p("本地复现", HEADING),
        p("在项目的 source 目录安装锁定依赖后运行以下命令。Excel 由本机 Python 和 openpyxl 读取。", SMALL),
        p("npm run experiment:c200<br/>npm run dev -- --port 5175", CODE),
        p("打开场景演示中的「东区真实预约回放」。回放汇总保存为 .qa/c200-replay.json。"
          "代码基于 compact-preferences-ui 的 22fafc5，实验代码位于本地 c200-reservation-replay 分支。", SMALL),
        p(f"预约原表 SHA-256　{summary['sourceSha256']}", SMALL),
    ])
    return story


def draw_page(canvas, doc):
    width, height = A4
    canvas.setFillColor(BLUE)
    canvas.setFont(BOLD, 9)
    canvas.drawString(MARGIN, height - 31, "SeatLink")
    canvas.setFillColor(MUTED)
    canvas.setFont(REGULAR, 9)
    canvas.drawRightString(width - MARGIN, height - 31, "C200 东区预约调度实验")
    canvas.setStrokeColor(LINE)
    canvas.line(MARGIN, height - 40, width - MARGIN, height - 40)
    canvas.line(MARGIN, 37, width - MARGIN, 37)
    canvas.drawString(MARGIN, 23, "实验说明　·　审阅稿")
    canvas.drawRightString(width - MARGIN, 23, f"{doc.page:02d} / 03")


def build(summary_file, output, reviewed_on):
    summary = json.loads(summary_file.read_text(encoding="utf-8"))
    observed, pressure = summary["workloads"]
    assert {observed["id"], pressure["id"]} == {"observed", "pressure"}
    story = [
        *overview(summary, observed, pressure, reviewed_on),
        PageBreak(),
        *methods(summary, observed, pressure),
        PageBreak(),
        *discussion(summary, observed, pressure),
    ]
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(".tmp.pdf")
    try:
        doc = SimpleDocTemplate(
            str(temporary), pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN,
            topMargin=53, bottomMargin=45,
            title="SeatLink C200 东区预约回放实验说明", author="SeatLink 项目",
        )
        doc.build(story, onFirstPage=draw_page, onLaterPages=draw_page)
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--summary", type=Path, default=SOURCE / ".qa/c200-replay.json")
    parser.add_argument("--output", type=Path, default=SOURCE.parent.parent / "output/pdf/SeatLink-C200东区预约回放实验说明.pdf")
    parser.add_argument("--review-date", default=datetime.now(tz=LOCAL_TIME).date().isoformat())
    args = parser.parse_args()
    load_fonts()
    build(args.summary, args.output, args.review_date)
    print(args.output)
