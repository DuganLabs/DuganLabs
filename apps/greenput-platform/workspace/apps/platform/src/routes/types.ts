/**
 * Each route exports a `render(deps): RouteView` function. The shell
 * mounts `view.element` into `<main>` and calls `view.dispose()` on
 * navigation. Effects (signal subscriptions, timers, fetches) live inside
 * the returned mount and are cleaned up explicitly.
 */

import type { PlatformDeps } from '../deps.js';
import type { Mount } from '../lib/dom.js';

export type RouteView = Mount;

export type RouteRender = (deps: PlatformDeps) => RouteView;
