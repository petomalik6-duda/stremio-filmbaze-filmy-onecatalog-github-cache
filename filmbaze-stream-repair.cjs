#!/usr/bin/env node
// Safe placeholder repair. It does not delete or overwrite working values.
// It only marks primaryVideo:null + detailChecked:true movies for retry.
require('./force-repair-primaryvideo-null.cjs');
