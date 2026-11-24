"""Replay the original holds and optional short use with local C200 and gate logs."""

import argparse
import hashlib
import json
import os
import runpy
from bisect import bisect_right
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from statistics import median
from warnings import filterwarnings

from openpyxl import load_workbook

SOURCE = Path(__file__).resolve().parent.parent
BOOKING_READER = runpy.run_path(str(SOURCE / "scripts/read-c200-workbook.py"))
MINUTE = 60
GRACE = 30 * MINUTE
SETUP = 2 * MINUTE
MIN_USE = 5 * MINUTE
PEAK = (18, 22)


@dataclass(frozen=True)
class GateHistory:
    times: tuple
    directions: tuple

    def state_at(self, instant):
        position = bisect_right(self.times, instant)
        if position:
            return self.directions[position - 1], self.times[position - 1]
        if self.directions and self.directions[0] == "inside":
            return "before_first_entry", None
        return "unknown", None

    def next_entry(self, instant):
        position = bisect_right(self.times, instant)
        for index in range(position, len(self.times)):
            if self.directions[index] == "inside":
                return self.times[index]
            if self.directions[index] == "unknown":
                break
        return None

    def next_uncertain(self, instant):
        position = bisect_right(self.times, instant)
        return next((self.times[i] for i in range(position, len(self.times))
                     if self.directions[i] == "unknown"), None)


def parse_gate(path, date, reader_keys):
    filterwarnings("ignore", message="Data Validation extension is not supported")
    matches = {str(key).strip(): f"reader-{index}" for key, index in reader_keys.items()}
    if len(matches) != len(reader_keys):
        raise ValueError("预约读者键规范化后存在冲突")
    book = load_workbook(path, read_only=True, data_only=True)
    raw = defaultdict(lambda: defaultdict(set))
    counts = Counter()
    try:
        sheet = book["Sheet"]
        sheet.reset_dimensions()
        values = sheet.values
        header = next(values)
        fields = ("学工号", "记录时间", "进出", "验证结果", "一级区域")
        columns = [header.index(name) for name in fields]
        for row in values:
            if all(value is None for value in row):
                continue
            counts["rows"] += 1
            key, stamp, direction, outcome, region = (row[index] for index in columns)
            if region != "主馆" or outcome != "成功" or not isinstance(stamp, datetime) or stamp.date().isoformat() != date:
                continue
            if direction not in ("进入", "出去"):
                continue
            counts["valid"] += 1
            counts["entries" if direction == "进入" else "exits"] += 1
            reader = matches.get(str(key).strip())
            if reader is not None:
                instant = BOOKING_READER["to_seconds"](stamp)
                raw[reader][instant].add("inside" if direction == "进入" else "outside")
    finally:
        book.close()

    histories = {}
    for reader, events in raw.items():
        times = tuple(sorted(events))
        directions = tuple(next(iter(events[time])) if len(events[time]) == 1 else "unknown" for time in times)
        counts["matchedAmbiguousTimes"] += directions.count("unknown")
        histories[reader] = GateHistory(times, directions)
    return histories, dict(counts)


@dataclass(frozen=True)
class Opportunity:
    start: int
    stop: int
    expected_stop: int
    source: str
    stop_event: str


def opportunity(request, history):
    start = request["start"]
    presence, _ = history.state_at(start)
    if presence not in ("outside", "before_first_entry") or request["release"] <= start:
        return presence, None
    expiry = start + GRACE
    stops = [(request["release"], "record_end"), (expiry, "grace")]
    entry = history.next_entry(start)
    if entry is not None:
        stops.insert(0, (entry, "entry"))
    uncertain = history.next_uncertain(start)
    if uncertain is not None:
        stops.insert(0, (uncertain, "ambiguous_gate"))
    stop, reason = min(stops, key=lambda item: item[0])
    return presence, Opportunity(start, stop, min(request["end"], expiry), presence, reason)


def seconds_in(start, stop, bounds):
    return max(0, min(stop, bounds[1]) - max(start, bounds[0]))


def interval_summary(windows, peak):
    lengths = [stop - start for start, stop in windows]
    peak_lengths = [seconds_in(start, stop, peak) for start, stop in windows]
    return {
        "count": len(lengths), "minutes": sum(lengths) / MINUTE,
        "medianMinutes": median(lengths) / MINUTE if lengths else None,
        "atLeast": {amount: sum(length >= amount * MINUTE for length in lengths) for amount in (5, 10, 15)},
        "peakCount": sum(length > 0 for length in peak_lengths),
        "peakMinutes": sum(peak_lengths) / MINUTE,
        "peakAtLeast": {amount: sum(length >= amount * MINUTE for length in peak_lengths) for amount in (5, 10, 15)},
    }


def rebooking_candidates(by_reader, histories):
    counts = Counter()
    candidate_readers = set()
    for reader, requests in by_reader.items():
        history = histories.get(reader)
        for old in requests:
            if old["release"] >= old["end"]:
                continue
            new = next((item for item in requests
                        if item["submit"] > old["submit"] and 0 <= item["submit"] - old["release"] <= 90 * MINUTE
                        and item["start"] > old["start"] and item["release"] > item["start"]), None)
            if new is None:
                continue
            counts["newLaterWithin90"] += 1
            before = old["release"] <= old["start"]
            counts["oldEndedByStart" if before else "oldEndedAfterStart"] += 1
            if history is None:
                continue
            state, _ = history.state_at(old["start"])
            entry = history.next_entry(old["start"])
            if state not in ("outside", "before_first_entry") or entry is None:
                continue
            counts["outsideAtStartAndLaterEntered"] += 1
            counts["lateOldEndedByStart" if before else "lateOldEndedAfterStart"] += 1
            if not before and old["release"] <= entry:
                counts["lateEndedBeforeEntering"] += 1
                if abs(old["release"] - old["start"] - GRACE) <= MINUTE:
                    counts["lateEndedNearGrace"] += 1
            candidate_readers.add(reader)
    return {**counts, "candidateReaders": len(candidate_readers)}


@dataclass(frozen=True)
class ShortIntent:
    reader: str
    start: int
    stop: int


def observed_intents(by_reader, histories):
    intents = []
    for reader, requests in by_reader.items():
        history = histories.get(reader)
        if history is None:
            continue
        for booking in requests:
            stop = booking["start"]
            if booking["release"] <= stop:
                continue
            state, entrance = history.state_at(stop - 1)
            if state != "inside":
                continue
            start = max(entrance, booking["submit"], stop - GRACE)
            if stop - start < SETUP + MIN_USE:
                continue
            if any(booking["id"] != other["id"] and other["start"] < stop
                   and other["release"] > max(other["start"], start) for other in requests):
                continue
            intents.append(ShortIntent(reader, start, stop))
    return intents


@dataclass(frozen=True)
class Offer:
    seat: str
    expected_stop: int
    window: Opportunity | None


def visible_offer(seat, reservations, by_booking_window, intent):
    now = intent.start
    visible = [r for r in reservations if r["submit"] <= now < r["release"]]
    held = next((r for r in visible if r["start"] <= now), None)
    if held is None:
        stop = min(intent.stop, min((r["start"] for r in visible), default=intent.stop))
        return Offer(seat, stop, None)
    window = by_booking_window.get(held["id"])
    if window and window.start <= now < window.stop:
        return Offer(seat, min(intent.stop, window.expected_stop), window)
    return None


def replay(by_seat, by_booking_window, intents, allow_borrowing):
    active_seat = {}
    active_reader = {}
    filled = Counter()
    for intent in sorted(intents, key=lambda item: (item.start, item.reader, item.stop)):
        now = intent.start
        if active_reader.get(intent.reader, -1) > now:
            filled["alreadySeated"] += 1
            continue
        offers = []
        for seat, bookings in by_seat.items():
            if active_seat.get(seat, -1) > now:
                continue
            offer = visible_offer(seat, bookings, by_booking_window, intent)
            if offer is None or offer.expected_stop - now < SETUP + MIN_USE:
                continue
            if offer.window is None or allow_borrowing:
                offers.append(offer)
        if not offers:
            filled["unassigned"] += 1
            continue

        # Offer choice uses the visible planned end. Recorded early events
        # shorten service after assignment and are never ranked by their time.
        offer = min(offers, key=lambda item: (item.window is not None, -item.expected_stop, item.seat))
        stop = offer.expected_stop
        if offer.window is not None:
            stop = min(stop, offer.window.stop)
            filled["borrowed"] += 1
            if offer.window.stop_event == "entry" and offer.window.stop < offer.expected_stop:
                filled["entryNotices"] += 1
        else:
            # A later historical booking has priority over the temporary seat.
            stop = min(stop, min((r["start"] for r in by_seat[offer.seat]
                                  if r["submit"] > now and r["release"] > r["start"]),
                                 default=stop))
        if stop < now:
            raise ValueError("临时使用分配早于请求到达")
        active_seat[offer.seat] = stop
        active_reader[intent.reader] = stop
        useful = max(0, stop - now - SETUP)
        filled["assigned"] += 1
        filled["useSeconds"] += useful
        filled["usedAtLeast5"] += useful >= MIN_USE
        if offer.window is not None:
            filled["borrowSeconds"] += useful
            filled["borrowedAtLeast5"] += useful >= MIN_USE
    return {
        "assigned": filled["assigned"], "unassigned": filled["unassigned"],
        "alreadySeated": filled["alreadySeated"], "usedAtLeast5": filled["usedAtLeast5"],
        "useMinutes": filled["useSeconds"] / MINUTE, "borrowed": filled["borrowed"],
        "borrowedAtLeast5": filled["borrowedAtLeast5"], "borrowMinutes": filled["borrowSeconds"] / MINUTE,
        "entryNotices": filled["entryNotices"],
    }


def stress_intents(peak, per_five_minutes):
    return [ShortIntent(f"stress-{index}-{number:02d}", instant, instant + 15 * MINUTE)
            for index, instant in enumerate(range(*peak, 5 * MINUTE))
            for number in range(per_five_minutes)]


def run(bookings, histories, gate_counts, stress_levels=(4, 8)):
    book_date = datetime.fromisoformat(bookings["date"])
    peak = tuple(BOOKING_READER["to_seconds"](book_date + timedelta(hours=hour)) for hour in PEAK)
    by_reader = defaultdict(list)
    by_seat = {seat: [] for seat in bookings["seats"]}
    windows = {}
    presence = Counter()
    empty_history = GateHistory((), ())
    for request in sorted(bookings["requests"], key=lambda r: (r["submit"], r["id"])):
        by_reader[request["readerId"]].append(request)
        by_seat[request["seatId"]].append(request)
        state, window = opportunity(request, histories.get(request["readerId"], empty_history))
        presence[state] += 1
        if window is not None:
            windows[request["id"]] = window

    actual_holds = [r for r in bookings["requests"] if r["release"] > r["start"]]
    for reservations in by_seat.values():
        last_stop = -1
        for booking in sorted(reservations, key=lambda item: item["start"]):
            if booking["release"] <= booking["start"]:
                continue
            if booking["start"] < last_stop:
                raise ValueError("原始座位记录存在重叠的有效预约")
            last_stop = booking["release"]
    edges = sorted({instant for r in actual_holds for instant in (r["start"], r["release"])})
    max_held = max((sum(r["start"] <= instant < r["release"] for r in actual_holds) for instant in edges), default=0)
    observed = observed_intents(by_reader, histories)
    recorded_exit_only = {key: value for key, value in windows.items() if value.source == "outside"}
    settings = []
    workloads = [("early_arrival_proxy", observed)]
    for level in stress_levels:
        workloads.append((f"evening_{level}_per_5min", [*observed, *stress_intents(peak, level)]))
    for name, intents in workloads:
        standard = replay(by_seat, windows, intents, False)
        borrowing = replay(by_seat, windows, intents, True)
        strict = replay(by_seat, recorded_exit_only, intents, True)
        for outcome in (standard, borrowing, strict):
            if outcome["assigned"] + outcome["unassigned"] + outcome["alreadySeated"] != len(intents):
                raise ValueError("短用回放请求数不一致")
        settings.append({"case": name, "intents": len(intents), "ordinary": standard, "withBorrowing": borrowing,
                         "extraUseMinutes": round(borrowing["useMinutes"] - standard["useMinutes"], 6),
                         "recordedExitOnlyExtraMinutes": round(strict["useMinutes"] - standard["useMinutes"], 6)})

    def summarize(only=None):
        return interval_summary([(w.start, w.stop) for w in windows.values() if only is None or w.source == only], peak)

    return {
        "date": bookings["date"], "seatCount": len(by_seat), "bookings": len(bookings["requests"]),
        "matchedBookings": sum(len(by_reader[reader]) for reader in histories),
        "uniqueBookers": len(by_reader), "matchedBookers": len(histories), "gate": gate_counts,
        "rules": {"graceMinutes": GRACE // MINUTE, "setupMinutes": SETUP // MINUTE,
                  "minPlannedUsefulMinutes": MIN_USE // MINUTE, "peak": list(PEAK)},
        "presenceAtBookingStart": dict(presence), "maxSimultaneousEffectiveHolds": max_held,
        "opportunities": {"all": summarize(), "afterRecordedExit": summarize("outside"),
                          "beforeFirstEntry": summarize("before_first_entry"),
                          "endedBy": dict(Counter(w.stop_event for w in windows.values()))},
        "rebooking": rebooking_candidates(by_reader, histories), "workloads": settings,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    workspace = SOURCE.parent.parent
    parser.add_argument("--bookings", type=Path, default=workspace / "data/2026-10-29-C200东区座位预约记录.xlsx")
    parser.add_argument("--gate", type=Path, default=workspace / "data/2026-10-29-主馆闸机记录.xlsx")
    parser.add_argument("--heavy-pressure", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    name = "c200-gate-heavy-pressure.json" if args.heavy_pressure else "c200-gate-replay.json"
    output = args.output or SOURCE / ".qa" / name
    if output.suffix.lower() != ".json":
        parser.error("--output 必须为 JSON 文件")
    reader_keys = {}
    bookings = BOOKING_READER["read_workbook"](args.bookings, reader_keys=reader_keys)
    histories, gate_counts = parse_gate(args.gate, bookings["date"], reader_keys)
    stress_levels = (8, 12, 16) if args.heavy_pressure else (4, 8)
    result = run(bookings, histories, gate_counts, stress_levels)
    if args.heavy_pressure:
        result["syntheticRequestsPerFiveMinutes"] = {"base": 8, "increase50Percent": 12, "increase100Percent": 16}
    result["sourceSha256"] = {"bookings": bookings["sourceSha256"],
                              "gate": hashlib.sha256(args.gate.read_bytes()).hexdigest()}
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f"{output.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
