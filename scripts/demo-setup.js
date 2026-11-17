// 離線 Demo：直接在瀏覽器內使用核心的示範服務（不需伺服器）
import { createMockTransitServices } from '../core/services/transit-mock.js';
globalThis.__DEMO_SERVICES__ = createMockTransitServices();
