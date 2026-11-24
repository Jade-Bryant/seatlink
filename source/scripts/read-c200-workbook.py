"""Read the experiment columns locally. The JSON pipe uses anonymous reader keys."""

import hashlib
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from warnings import filterwarnings

from openpyxl import load_workbook

FIELDS = (
    "申请人学工号",
    "座位名称",
    "空间名称",
    "提交时间",
    "预约开始时间",
    "预约结束时间",
    "预约真实结束时间",
)
LOCAL_TIME = timezone(timedelta(hours=8))
EAST_ZONE = "C200-东区（E）"


def to_seconds(value):
    if not isinstance(value, datetime):
        raise ValueError("预约时间字段有空值或格式错误")
    return int(value.replace(tzinfo=LOCAL_TIME).timestamp())


def read_workbook(path, *, reader_keys=None):
    filterwarnings("ignore", message="Workbook contains no default style")
    book = load_workbook(path, read_only=True, data_only=True)
    requests = []
    if reader_keys is None:
        reader_keys = {}
    dates = set()
    later_end = 0
    try:
        sheet = book["座位预约记录"]
        # This export declares A1:A1 despite containing all the rows.
        sheet.reset_dimensions()
        rows = sheet.values
        header = next(rows)
        columns = [header.index(field) for field in FIELDS]
        for row_number, values in enumerate(rows, start=2):
            if not any(value is not None for value in values):
                continue
            try:
                reader, seat, zone, submitted, start, end, actual_end = (
                    values[index] for index in columns
                )
                if not reader or not seat or zone != EAST_ZONE:
                    raise ValueError("缺少读者或座位字段，或空间不是 C200 东区")
                submit, begin, finish, actual = map(to_seconds, (submitted, start, end, actual_end))
                if submit > begin or finish <= begin or actual < submit:
                    raise ValueError("提交、预约或真实结束的时间顺序异常")
                dates.add(start.date().isoformat())
                later_end += actual > finish
                reader_key = reader_keys.setdefault(reader, len(reader_keys) + 1)
                requests.append(dict(
                    id=row_number, readerId=f"reader-{reader_key}", seatId=str(seat).strip(),
                    submit=submit, start=begin, end=finish, release=min(actual, finish),
                ))
            except (IndexError, ValueError) as exc:
                raise ValueError(f"预约表第 {row_number} 行：{exc}") from None
    finally:
        book.close()

    if len(dates) != 1:
        raise ValueError("预约表必须只含一天的 C200 东区记录")
    return dict(
        date=dates.pop(),
        seats=sorted({request["seatId"] for request in requests}),
        requests=requests,
        endedAfterBooked=later_end,
        sourceSha256=hashlib.sha256(path.read_bytes()).hexdigest(),
    )


if __name__ == "__main__":
    try:
        print(json.dumps(read_workbook(Path(sys.argv[1])), ensure_ascii=True))
    except (ValueError, OSError, KeyError) as exc:
        sys.exit(str(exc))
