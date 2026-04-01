// Returns the Unix timestamp (seconds) of last Sunday midnight in Israel time (UTC+3).
// This is the start of the Israeli work week. Used as the message lookback floor.
function getWeekStartTs() {
  const ISRAEL_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+3
  // Shift now into Israel "virtual UTC" so getUTCDay() gives Israel's day-of-week
  const israelNow = new Date(Date.now() + ISRAEL_OFFSET_MS);
  const dayOfWeek = israelNow.getUTCDay(); // 0=Sun, 1=Mon, …, 6=Sat in Israel

  // Build Sunday midnight in Israel local time, represented as a UTC Date object
  const sunday = new Date(israelNow.getTime());
  sunday.setUTCDate(israelNow.getUTCDate() - dayOfWeek); // roll back to Sunday
  sunday.setUTCHours(0, 0, 0, 0); // midnight (in Israel's shifted UTC view)

  // Convert back to real UTC by removing the Israel offset, then to seconds
  return (sunday.getTime() - ISRAEL_OFFSET_MS) / 1000;
}

module.exports = { getWeekStartTs };
