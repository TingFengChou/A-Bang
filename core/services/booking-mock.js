// 導訂票（示範版）：介面與 booking.js 相同。連到官方訂票網站首頁（不帶參數），標示示範；不會真的帶入車次。
import { OFFICIAL_BOOKING, LINK_TTL_MIN, validateBooking, bookingSummary } from './booking.js';

export function createMockBookingServices({ rail }) {
  return {
    booking: {
      async railLink(p, now = Date.now()) {
        const b = await validateBooking(rail, p, now);
        return {
          system: b.system, url: OFFICIAL_BOOKING[b.system],
          expiresAt: new Date(now + LINK_TTL_MIN * 60e3).toISOString(),
          summary: bookingSummary(b), tickets: b.tickets, demo: true,
          note: '示範模式：連到官方訂票網站首頁，不會自動帶入車次；正式版需 TDX 導訂票權限',
        };
      },
    },
  };
}
