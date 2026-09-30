// Rank Candidate Slots
// Deterministic ranking. Priority changes the ORDER of options, never whether a slot is valid.
//   HIGH   : earliest feasible start first
//   NORMAL/LOW: inside requested window → requested day → requester's alternative dates →
//               fewest days away → closest time-of-day to the request
// @include _shared/time-utils.js
// @include _shared/availability-utils.js

function reasonFor(c, priority) {
  if (c.within_preferred_window) return 'Inside the requested time window';
  if (priority === 'HIGH') {
    const when = c.day_offset < 0 ? `${-c.day_offset} day${c.day_offset === -1 ? '' : 's'} earlier than requested` : c.day_offset === 0 ? 'same day as requested' : `${c.day_offset} day${c.day_offset === 1 ? '' : 's'} after the requested day`;
    return `Earliest feasible slot for a HIGH-priority request (${when})`;
  }
  if (c.is_preferred_date) return `Same day as requested, ${c.minutes_from_requested_time} min from requested time`;
  if (c.is_alternative_date) return `Alternative date offered by requester, ${c.minutes_from_requested_time} min from requested time of day`;
  return `Next available business day (+${c.day_offset} day${c.day_offset === 1 ? '' : 's'}), ${c.minutes_from_requested_time} min from requested time of day`;
}

const out = [];
for (const [i, item] of $input.all().entries()) {
  const j = { ...item.json };
  const cfg = j.config || {};
  const list = (j.raw_candidates || []).slice();
  const dateClass = (c) => (c.is_preferred_date ? 0 : c.is_alternative_date ? 1 : 2);
  if (j.booking_priority === 'HIGH') {
    list.sort((a, b) => (b.within_preferred_window - a.within_preferred_window) || a.start_utc.localeCompare(b.start_utc));
  } else {
    list.sort((a, b) =>
      (b.within_preferred_window - a.within_preferred_window) ||
      (dateClass(a) - dateClass(b)) ||
      (Math.abs(a.day_offset) - Math.abs(b.day_offset)) ||
      (a.minutes_from_requested_time - b.minutes_from_requested_time) ||
      a.start_utc.localeCompare(b.start_utc));
  }
  j.ranked_candidates = list.slice(0, 25).map((c, idx) => ({ ...c, rank: idx + 1, rank_reason: reasonFor(c, j.booking_priority) }));
  // Preliminary shortlist before in-batch holds (Booking Decision finalizes it).
  j.candidate_shortlist = pickDiverse(j.ranked_candidates, cfg).map((c) => `${c.rank}. ${c.business}`);
  delete j.raw_candidates;
  out.push({ json: j, pairedItem: { item: i } });
}
return out;
