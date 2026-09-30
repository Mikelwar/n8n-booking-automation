// DEMO · Load Booking Requests
// Emits the fictional requests from test-data/sample-bookings.json (embedded at build time). Offline only.

const DEMO_BOOKINGS = /*@@DEMO_BOOKINGS@@*/[];

return DEMO_BOOKINGS.map((b) => ({ json: b }));
