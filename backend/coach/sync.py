from datetime import date, timedelta
from dateutil.relativedelta import relativedelta


def sync_window(today: date, last: date | None):
    backfill = today - relativedelta(months=12)
    return max(backfill, last - timedelta(days=7)) if last else backfill, today
