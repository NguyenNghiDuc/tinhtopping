// Clean advanced feature bundle.
// Each feature owns one responsibility and initializes itself exactly once.
// No broad document observers, no duplicate toolbar owners, no automatic draft restore.

import './features/editor-tools.js';
import './features/backup-csv.js';
import './features/employee-report.js';
import './features/offline-draft.js';
