// 離線 Demo：直接在瀏覽器內使用核心的示範服務（不需伺服器）
import { createMockTransitServices } from '../core/services/transit-mock.js';
import { traTrips } from '../core/services/rail-trips.js';
const svc = createMockTransitServices();
svc.traTrips = (a) => traTrips(svc, a); // 台鐵時刻表頁：直達＋要換車的走法（與伺服器 /api/v1/tra/timetable 相同）
globalThis.__DEMO_SERVICES__ = svc;
