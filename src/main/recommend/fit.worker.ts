/* One of the threads a station's fit is split across. Each takes its share of every pass, and they wait for each other between. */

import { parentPort } from 'node:worker_threads';
import { adamStep, gradientOf, residualsOf, STATION_TUNING } from './stations';
import { barrier, shareOf, type FitTask } from './fitShare';

parentPort?.on('message', (task: FitTask) => {
  const { part, parts, features, dimensions, rows, labels, weights, model, residuals, gradient, moments, control } =
    task;
  const library = { features, dimensions, voice: null, energy: null, sung: null };
  const set = { rows, labels, weights };
  const [rowFrom, rowTo] = shareOf(rows.length, part, parts);
  const [weightFrom, weightTo] = shareOf(dimensions + 1, part, parts);
  for (let step = 1; step <= STATION_TUNING.steps; step++) {
    residualsOf(library, set, model, rowFrom, rowTo, residuals);
    if (!barrier(control, parts)) break;
    gradientOf(library, set, residuals, model, weightFrom, weightTo, gradient);
    adamStep(model, gradient, moments, step, weightFrom, weightTo);
    if (!barrier(control, parts)) break;
  }
  parentPort?.postMessage('done');
});
