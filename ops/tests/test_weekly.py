import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from relay import due_jobs


def test_weekly_sunday_at_20_amsterdam_with_stable_key():
    tz = ZoneInfo('Europe/Amsterdam')
    started = datetime(2026, 7, 1, tzinfo=tz)
    due = due_jobs(datetime(2026, 7, 5, 20, tzinfo=tz), started)
    assert {'kind': 'weekly', 'key': 'weekly:2026-07-05'} in due
    assert not any(j['kind'] == 'weekly' for j in due_jobs(datetime(2026, 7, 5, 19, 59, tzinfo=tz), started))
    assert not any(j['kind'] == 'weekly' for j in due_jobs(datetime(2026, 7, 6, 20, tzinfo=tz), started))
