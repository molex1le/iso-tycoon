import { defaultConfig } from '../src/core/config';

// Случайные события ставят партию на паузу в непредсказуемые дни.
// Точные тесты механик идут без них, события проверяются отдельно в events.test.ts.
defaultConfig.events = [];
